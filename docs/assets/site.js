const command = document.querySelector("#install-command")
const copyButton = document.querySelector("[data-copy-target]")

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((node) => { node.textContent = value })
}

function setInstallCommand(value) {
  if (!value) return
  if (command) command.textContent = value
  document.querySelectorAll(".install-command").forEach((node) => { node.textContent = value })
}

async function copyInstallCommand() {
  if (!command || !copyButton) return
  const status = document.querySelector(".copy-status")
  const fallbackCopy = () => {
    const input = document.createElement("textarea")
    input.value = command.textContent
    input.setAttribute("readonly", "")
    input.style.position = "fixed"
    input.style.opacity = "0"
    document.body.append(input)
    input.select()
    const copied = document.execCommand("copy")
    input.remove()
    if (!copied) throw new Error("copy command was rejected")
  }
  try {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(command.textContent)
      } catch {
        fallbackCopy()
      }
    } else {
      fallbackCopy()
    }
    copyButton.textContent = "Copied"
    if (status) status.textContent = "Installation command copied."
    window.setTimeout(() => { copyButton.textContent = "Copy" }, 1800)
  } catch {
    if (status) status.textContent = "Copy unavailable — select the command manually."
  }
}

copyButton?.addEventListener("click", copyInstallCommand)

fetch("release-data.json", { credentials: "same-origin" })
  .then((response) => {
    if (!response.ok) throw new Error("release data unavailable")
    return response.json()
  })
  .then((data) => {
    setText(".release-version", `v${data.version}`)
    setText(".release-tag", data.tag)
    setText(".agent-count", String(data.agentCount))
    setText(".primary-agent", data.primaryAgent)
    setText(".release-commit", data.releaseCommit)
    setInstallCommand(data.installCommand)
  })
  .catch(() => {
    // Static fallback content remains visible when release-data.json is unavailable.
  })
