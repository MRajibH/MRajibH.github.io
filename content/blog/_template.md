---
title: "A specific title, 15 to 70 characters"
description: "One or two sentences, 50 to 160 characters, saying what the reader will learn. Shown in search results."
date: 2026-01-31
# updated: 2026-02-15
tags: [linux]          # one or more slugs from content/topics.json
# The animated illustration shown at the top of the article. kind is one of:
#   flow     - steps left to right        layers  - stacked layers
#   compare  - "Name | short note" cards  terminal - command lines
art:
  kind: flow
  caption: "One sentence saying what the diagram shows."
  items: ["First step", "Second step", "Third step"]
draft: true            # remove this line (or set false) only when the article is finished
---

Files starting with an underscore, like this one, are never published.

Open with the problem and what the reader will be able to do by the end. Do not
repeat the title as a heading: the title is already the page heading.

## First section

Use `##` for sections (at least three) and `###` inside them. The first three
sections come before the mid-article ad, so put the most useful material there.

## Second section

Show real commands and configuration, and say what they do:

```bash
echo "fenced code blocks with a language get syntax highlighting"
```

## Third section

Before publishing, `npm run check:content` must pass. It rejects published
articles with fewer than 800 words of prose, fewer than three sections,
placeholder text, a missing description or an unknown tag.
