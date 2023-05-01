<img align="right" width="200" height="200" src="https://user-images.githubusercontent.com/43757878/235487376-ce2ff787-f006-4815-a44b-2ddfbc549b15.jpg">




# Hi there, I'm Md. Rajib Hawlader 👋



I am a passionate computer science graduate from <a href="https://ewubd.edu">East West University</a>, currently working as a software engineer with a focus on Cloud and DevSecOps at <a href="https://brotecs.com">BroTecs Technologies Limited</a>. 🚀

<!-- Add a toggle button for dark and light mode -->
<button onclick="toggleDarkMode()" class="moon-button">🌙</button>

<script>
function toggleDarkMode() {
  const body = document.querySelector('body');
  const isDarkMode = body.classList.toggle('dark-mode');
  localStorage.setItem('isDarkMode', isDarkMode);
}
// Set dark mode by default
if (localStorage.getItem('isDarkMode') === 'true' || (!'isDarkMode' in localStorage && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.querySelector('body').classList.add('dark-mode');
}
</script>

<style>
:root {
  --background-color: #282c35;
  --text-color: #ffffff;
}

@media (prefers-color-scheme: light) {
  :root {
    --background-color: #ffffff;
    --text-color: #000000;
  }
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
}

/* Define styles for dark mode */
.dark-mode {
  --background-color: #282c35;
  --text-color: #ffffff;
}

/* Styles for moon button */
.moon-button {
  background-color: transparent;
  border: none;
  color: #ffffff;
  cursor: pointer;
  font-size: 24px;
  position: fixed;
  right: 10px;
  top: 10px;
  z-index: 999;
}
.moon-button:focus {
  outline: none;
}
</style>
## 💻 Tech Stack

Here are a few technologies that I have been working with recently:

* Cloud: AWS, Google Cloud Platform, Microsoft Azure
* DevOps: Docker, Kubernetes, Jenkins, Ansible
* Programming Languages: Java, Python, JavaScript, TypeScript
* Databases: MySQL, MongoDB, PostgreSQL

## 🔭 I’m currently working on

- Building automated cloud infrastructure and deployment pipelines.
- Learning new DevOps tools and best practices.

## 🌱 I’m currently learning

- Advanced Kubernetes concepts such as Operators and Custom Resource Definitions.
- Serverless computing with AWS Lambda and Google Cloud Functions.

## 💬 Ask me about

- Anything related to cloud computing and DevOps.
- Career advice for software engineering and cloud computing.

## 📫 How to reach me

- Email: rajib104.ewubd@gmail.com

- LinkedIn: [https://www.linkedin.com/in/mrajibh/](https://www.linkedin.com/in/mrajibh/)

## 😄 Pronouns

He/Him

Thanks for checking out my profile. Let's connect! 😊

