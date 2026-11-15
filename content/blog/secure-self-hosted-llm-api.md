---
title: "Securing a self-hosted LLM API: auth, TLS and rate limits"
description: "Protect a self-hosted LLM endpoint with layered defences: private binding, an nginx reverse proxy with TLS, per-client API keys, route allowlists and rate limits."
date: 2026-11-15
tags: [self-hosted-llms, devsecops]
draft: true
---

Most model servers are built to be easy to start, not safe to expose. Ollama has no login at all, and vLLM's built-in key covers only part of its API. Put either one on a public address as it comes and anyone who finds the port can use your GPU, read whatever the model can reach, and in some cases control the server. This guide builds the protection in layers: by the end you will have a model server that listens only locally, an nginx reverse proxy that terminates TLS, checks a key per client, forwards only the routes you choose and limits how hard any one client can push.

The examples use nginx on a Debian or Ubuntu host in front of a server speaking the OpenAI-compatible API on port 8000. The same design applies to any backend.

## What you are defending against

It helps to name the risks before choosing controls, because each control below answers a specific one.

| Risk | What happens | Control |
| --- | --- | --- |
| Open access | Strangers run their own workloads on your hardware | Private binding, authentication |
| Eavesdropping | Prompts, answers and keys cross the network in clear text | TLS |
| Shared credentials | One leaked key means everyone must rotate | One key per client |
| Exposed management routes | Unauthenticated endpoints reveal or change server state | Route allowlist at the proxy |
| Resource exhaustion | One client, or one bug in a loop, starves everyone else | Rate, connection and size limits |
| Leaky logs | Prompts containing personal or confidential data end up in log files | Careful log format, no request bodies |

Two things are outside the scope of network controls. The first is what the model does with hostile text inside a prompt; that is covered in [Prompt injection defence](/blog/prompt-injection-defence/). The second is the host itself: none of this helps if the machine is easy to break into, so work through the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/) as well.

## Layer 1: keep the model server off the network

The first control costs nothing: do not let the model server listen where clients can reach it directly. Everything should go through the proxy, so the proxy's rules cannot be bypassed.

**Ollama** binds to `127.0.0.1` on port 11434 by default, which is the safe setting. It becomes reachable from other machines only if `OLLAMA_HOST` is set to something like `0.0.0.0`, typically in a systemd override. Check that nobody has done that:

```bash
systemctl cat ollama.service | grep -i OLLAMA_HOST
```

**vLLM** takes a `--host` option. Set it explicitly to `127.0.0.1` when running it directly on the host.

**Docker** needs particular care. `-p 8000:8000` publishes the port on every interface, and Docker writes its own firewall rules, so a published port can be reachable even when `ufw` appears to block it. Always give the address:

```bash
docker run -p 127.0.0.1:8000:8000 ...
```

Better still, when the proxy also runs in a container, do not publish the model port at all and let the two talk over a private Docker network. [Docker security best practices](/blog/docker-security-best-practices/) goes further into container networking.

Then verify from the host what is actually listening, and on which address:

```bash
sudo ss -tlnp | grep -E ':(8000|11434|4000)\b'
```

Every model port should show `127.0.0.1` (or a private container address), never `0.0.0.0` or `[::]`. Finish with a host firewall that allows only SSH and the proxy:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port 80 stays open only for certificate issuance and the redirect to HTTPS. If the API is for internal use, restrict 443 to your office or VPN range instead of allowing it from anywhere, for example with `sudo ufw allow from 10.20.0.0/16 to any port 443 proto tcp`. An API that is not reachable from the internet at all is the strongest position of the lot.

## Layer 2: TLS at a reverse proxy

A reverse proxy is a server that accepts client connections and forwards them to a backend. Putting nginx in front gives you one place for encryption, authentication and limits, and lets the model server stay simple.

TLS (Transport Layer Security) encrypts the connection. Without it, every prompt, every answer and every API key is readable by anything on the network path. Install nginx and Certbot, and request a certificate for the host name that points at this server:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d llm.example.com
```

Certbot obtains a certificate from Let's Encrypt, edits the nginx configuration to use it, and installs a timer that renews it automatically. Confirm that renewal will work before you forget about it:

```bash
sudo certbot renew --dry-run
```

This method needs the host to be reachable from the internet on port 80. For a server that is internal only, either use Certbot's DNS challenge, which proves control of the domain through a DNS record instead of an inbound connection, or issue certificates from a private certificate authority that your clients trust. Do not fall back to plain HTTP because the network is "internal"; internal networks are where stolen credentials get reused.

## Layer 3: one API key per client

Authentication answers "who is calling". A single shared key answers it badly: you cannot tell clients apart in logs, and revoking one means changing all of them. Give each application its own key.

nginx can do this with a `map`, which looks up one value from another. Here the lookup key is the `Authorization` header and the result is a client name. Generate a key and add it to a file that only root and nginx can read:

```bash
sudo touch /etc/nginx/llm_keys.map
sudo chown root:www-data /etc/nginx/llm_keys.map
sudo chmod 640 /etc/nginx/llm_keys.map

KEY="sk-$(openssl rand -hex 32)"
printf '"Bearer %s" support-bot;\n' "$KEY" | sudo tee -a /etc/nginx/llm_keys.map > /dev/null
echo "Give this key to the support-bot application: $KEY"
```

Each line of the file pairs a full header value with a client name. The key is 32 random bytes, which is far beyond guessing. Now create `/etc/nginx/conf.d/llm-limits.conf`, which is loaded in the `http` context:

```nginx
# Resolve the Authorization header to a client name. Unknown keys give "".
map $http_authorization $api_client {
    default "";
    include /etc/nginx/llm_keys.map;
}

# Rate and connection limits, counted per client name.
limit_req_zone  $api_client zone=llm_rate:10m rate=60r/m;
limit_conn_zone $api_client zone=llm_conn:10m;

# Log who called and how long it took. No request bodies, no keys.
log_format llm '$remote_addr $api_client [$time_local] "$request_method $uri" '
               '$status $body_bytes_sent $request_time';
```

A request with a missing or unknown key resolves to an empty client name, which the server block below rejects. To revoke a client, delete its line and reload nginx. To rotate a key, add the new line, move the client over, then remove the old one.

If the backend also expects a key, as vLLM does when started with `--api-key`, the proxy must replace the client's key with the backend's. Keep that in its own protected file, `/etc/nginx/llm_upstream_auth.conf`, with the same ownership and mode as the key map:

```nginx
proxy_set_header Authorization "Bearer the-key-your-backend-expects";
```

Clients never learn the backend key, and a client key is useless against the backend directly. If the backend needs no key, put `proxy_set_header Authorization "";` in that file instead, so client keys are not forwarded.

### When static keys are not enough

A key file in nginx is easy to understand and has no moving parts, but it does not scale to many clients or give you budgets. This table shows where the alternatives fit.

| Method | Good for | Limits |
| --- | --- | --- |
| Backend's own key (vLLM `--api-key`) | A second barrier behind the proxy | One shared key; does not cover every route |
| Static keys in nginx | A handful of services | Manual rotation; request limits only |
| Gateway with virtual keys | Many applications, per-key token limits and budgets | Another service and a database to run |
| Mutual TLS (client certificates) | Service-to-service calls inside one organisation | Certificate issuance and renewal to manage |
| Single sign-on proxy | People using a browser interface | Not suited to API clients |

For the gateway approach, [setting up a LiteLLM gateway](/blog/litellm-gateway-self-hosted/) shows how to issue keys with per-key token limits. The gateway then sits between nginx and the model server, and nginx keeps the TLS and route-filtering jobs.

## Layer 4: forward only the routes clients need

Model servers expose more than the chat endpoint. vLLM's security documentation states that its API key is enforced only on certain path prefixes such as `/v1`, and lists routes that remain open without it, including health, metrics and tokenisation endpoints and some that control the running server. Its recommendation is the one applied here: allow the endpoints you intend to offer and block everything else at the proxy.

This server block does that. It replaces the one Certbot edited, keeping the certificate paths Certbot created:

```nginx
upstream llm_backend {
    server 127.0.0.1:8000;
    keepalive 16;
}

server {
    listen 80;
    server_name llm.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name llm.example.com;

    ssl_certificate     /etc/letsencrypt/live/llm.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/llm.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;

    access_log /var/log/nginx/llm_access.log llm;
    client_max_body_size 2m;
    limit_req_status  429;
    limit_conn_status 429;

    # Only these routes reach the model server.
    location ~ ^/v1/(chat/completions|completions|embeddings|models)$ {
        if ($api_client = "") { return 401; }

        limit_req  zone=llm_rate burst=20 nodelay;
        limit_conn llm_conn 8;

        proxy_pass http://llm_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        include /etc/nginx/llm_upstream_auth.conf;

        # Streaming responses must not be buffered or cut off early.
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Everything else, including /metrics and management routes.
    location / { return 404; }
}
```

The location pattern is an allowlist: a route not named in it never reaches the backend, whether or not the caller has a key. Monitoring should scrape `/metrics` from the host itself over loopback, not through the public proxy.

The streaming settings matter for usability. Chat clients usually ask for a streamed response, where tokens arrive as they are generated. nginx buffers upstream responses by default, which would hold the text back and deliver it in one piece, so buffering is turned off. The read timeout is raised because the default of 60 seconds between upstream writes can cut off a slow generation.

Test the configuration and load it:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Layer 5: limits on rate, concurrency and size

Limits keep one client from consuming the whole GPU, and they turn a runaway retry loop into a few rejected requests instead of an outage. The configuration above applies four.

- **Request rate.** `limit_req_zone` defines a shared counter keyed on the client name with an average of 60 requests per minute. `burst=20 nodelay` lets a client briefly exceed the average by up to 20 requests without being slowed, after which further requests are rejected. nginx answers rejected requests with status 503 unless told otherwise, so `limit_req_status 429` is set to return the conventional "too many requests" code that client libraries know how to back off from.
- **Concurrent connections.** `limit_conn llm_conn 8` allows each client at most eight requests in flight. For a model server this is often the more meaningful limit, because a long generation occupies the GPU for its whole duration no matter how few requests per minute there are.
- **Request size.** `client_max_body_size 2m` rejects oversized request bodies before they reach the backend. Raise it if clients legitimately send images or very long documents.
- **Time.** The proxy timeouts bound how long a stalled request can hold a connection.

The specific numbers are examples. Choose values from what your clients actually need and what the server can sustain, then adjust from the logs.

nginx counts requests, not tokens, and one request for a very long answer costs far more than one for a short answer. Close that gap in two places: make applications send a sensible `max_tokens`, and cap the context length on the model server itself (for vLLM, `--max-model-len` and `--max-num-seqs`, described in [Serving LLMs in production with vLLM](/blog/vllm-production-deployment/)). If you need true per-key token limits, that is a job for a gateway.

## Check that it works

Do not assume the configuration does what it says. Test each layer from another machine.

```bash
# No key: expect 401
curl -s -o /dev/null -w "%{http_code}\n" https://llm.example.com/v1/models

# Valid key: expect 200
curl -s -o /dev/null -w "%{http_code}\n" https://llm.example.com/v1/models \
  -H "Authorization: Bearer $KEY"

# A route that is not on the allowlist: expect 404 even with a valid key
curl -s -o /dev/null -w "%{http_code}\n" https://llm.example.com/metrics \
  -H "Authorization: Bearer $KEY"

# The model port must not answer from outside: expect a timeout or refusal
curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://llm.example.com:8000/v1/models

# Exceed the rate limit: expect 429 responses to appear
for i in $(seq 1 120); do
  curl -s -o /dev/null -w "%{http_code} " https://llm.example.com/v1/models \
    -H "Authorization: Bearer $KEY"
done; echo
```

Then send a streamed chat request and confirm that text arrives progressively. Finally, read `/var/log/nginx/llm_access.log` and check that each line shows the client name and that no key or prompt text appears anywhere in it.

## Common mistakes

**Trusting the firewall with Docker.** Published container ports can bypass `ufw` rules. Bind published ports to `127.0.0.1` and verify with `ss` and an external request, not by reading the firewall rules.

**Relying on the backend's key alone.** It is one shared secret, and on vLLM it does not protect every route. Use it as a second barrier, with the proxy as the first.

**Proxying every path.** A catch-all `location /` with `proxy_pass` forwards management and metrics routes along with the API. Allowlist instead.

**Leaving buffering on.** Streaming appears broken, with the whole answer arriving at once. Set `proxy_buffering off` for the API location.

**Logging too much.** Logging request bodies, or the `Authorization` header, writes prompts and credentials to disk where backups and log shippers copy them. Log the client name, status, size and timing. Check the model server's and gateway's own logging settings too, since debug modes often print prompts.

**Keys in the wrong places.** Keys committed to a repository, pasted into chat, or embedded in browser-side JavaScript are public. A key shipped to a browser belongs to every visitor; browser applications should call your own backend, which holds the key. [Secrets management](/blog/secrets-management-guide/) covers storage and rotation.

**Wide-open cross-origin settings.** Setting allowed origins to `*` to make a web page work lets any site a user visits call the API from their browser. List the specific origins you serve.

**No plan for revocation.** If removing one client's access means editing every application, it will not happen quickly when it matters. Per-client keys make it a one-line change.

## Frequently asked questions

### Is the built-in API key in vLLM or a gateway enough?

Not for anything reachable from an untrusted network. vLLM's documentation says not to rely on its key alone, because routes outside the protected prefixes stay open. A gateway's keys are much more capable, but the gateway still needs TLS in front and should not expose its admin routes to the world. Use the built-in mechanisms and the proxy together.

### Do I need TLS if the API is only used inside my network?

Yes. Internal traffic passes through switches, Wi-Fi, VPN concentrators and other hosts you may not control as tightly as you think, and API keys sent in clear text can be captured and replayed by anything on that path. Certificates from a private certificate authority or from a DNS challenge make internal TLS routine.

### Should I use nginx, Caddy or Traefik?

Any of them can implement this design: private backend, TLS, authentication, route allowlist and limits. This guide uses nginx because it is widely packaged and its rate limiting is built in. Choose the proxy your team already operates and understands; a familiar tool configured correctly beats a better one configured by guesswork.

### How should I rotate API keys?

Add the new key alongside the old one, deploy it to the client, confirm from the access log that the client is using it, then remove the old line and reload nginx. Because each client has its own key, rotation affects one application at a time. Rotate immediately when a key may have been exposed, and on a regular schedule otherwise.

### Can I expose Ollama directly if I set a firewall rule?

A firewall rule limits who can connect, but Ollama itself will serve anyone who gets through, including pulling and deleting models, because it has no authentication of its own. Restricting by source address is a reasonable control for a trusted private network. For anything broader, keep Ollama on loopback and put an authenticating proxy in front of it, forwarding only the routes you need.
