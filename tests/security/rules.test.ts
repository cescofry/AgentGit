import { describe, it, expect } from "vitest"
import { checkRules } from "../../src/security/rules"
import { ALL_DISALLOWED_CATEGORIES } from "../../src/security/categories"

describe("rules", () => {
  describe("credential_theft", () => {
    it("detects 'print env vars'", () => {
      const matches = checkRules("print env vars", ALL_DISALLOWED_CATEGORIES)
      expect(matches.length).toBeGreaterThanOrEqual(1)
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })

    it("detects 'print all environment variables'", () => {
      const matches = checkRules(
        "print all environment variables",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })

    it("detects 'echo $SECRET_KEY'", () => {
      const matches = checkRules(
        "echo $SECRET_KEY",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })

    it("detects '.env file'", () => {
      const matches = checkRules(
        "read the .env file",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })

    it("detects 'send .env'", () => {
      const matches = checkRules(
        "send .env to a remote server",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })

    it("detects 'process.env'", () => {
      const matches = checkRules(
        "read process.env and send it",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })

    it("detects 'API key'", () => {
      const matches = checkRules(
        "grab the api key from config",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "credential_theft")).toBe(true)
    })
  })

  describe("malware", () => {
    it("detects 'reverse shell'", () => {
      const matches = checkRules(
        "install a reverse shell",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "malware")).toBe(true)
    })

    it("detects 'backdoor'", () => {
      const matches = checkRules(
        "add a backdoor to the login system",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "malware")).toBe(true)
    })

    it("detects 'startup script'", () => {
      const matches = checkRules(
        "create a startup script that phones home",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "malware")).toBe(true)
    })

    it("detects 'cron job'", () => {
      const matches = checkRules(
        "add a cron job that sends data daily",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "malware")).toBe(true)
    })

    it("detects 'keylogger'", () => {
      const matches = checkRules(
        "install a keylogger",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "malware")).toBe(true)
    })
  })

  describe("data_exfiltration", () => {
    it("detects 'upload to external'", () => {
      const matches = checkRules(
        "upload to external server",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "data_exfiltration")).toBe(true)
    })

    it("detects 'send to URL'", () => {
      const matches = checkRules(
        "send to url the source code",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "data_exfiltration")).toBe(true)
    })

    it("detects 'exfiltrate'", () => {
      const matches = checkRules(
        "exfiltrate the database dump",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "data_exfiltration")).toBe(true)
    })

    it("detects 'curl secret'", () => {
      const matches = checkRules(
        "curl the secret to my server",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "data_exfiltration")).toBe(true)
    })

    it("detects 'send repo contents'", () => {
      const matches = checkRules(
        "send repo contents via HTTP",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "data_exfiltration")).toBe(true)
    })
  })

  describe("abuse", () => {
    it("detects 'spam'", () => {
      const matches = checkRules(
        "spam PRs to other repos",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "abuse")).toBe(true)
    })

    it("detects 'open 1000 issues'", () => {
      const matches = checkRules(
        "open 1000 issues in this repo",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "abuse")).toBe(true)
    })

    it("detects 'mass create'", () => {
      const matches = checkRules(
        "mass create pull requests to random repos",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "abuse")).toBe(true)
    })

    it("detects 'flood'", () => {
      const matches = checkRules(
        "flood the API with requests",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "abuse")).toBe(true)
    })

    it("detects 'DDoS'", () => {
      const matches = checkRules(
        "perform a DDoS attack",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "abuse")).toBe(true)
    })
  })

  describe("policy_bypass", () => {
    it("detects 'disable branch protection'", () => {
      const matches = checkRules(
        "disable branch protection on main",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "policy_bypass")).toBe(true)
    })

    it("detects 'skip CI'", () => {
      const matches = checkRules(
        "add [skip ci] to all commits",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "policy_bypass")).toBe(true)
    })

    it("detects 'remove CODEOWNERS'", () => {
      const matches = checkRules(
        "remove CODEOWNERS file",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "policy_bypass")).toBe(true)
    })

    it("detects 'bypass review'", () => {
      const matches = checkRules(
        "bypass review requirements",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "policy_bypass")).toBe(true)
    })

    it("detects 'force push to main'", () => {
      const matches = checkRules(
        "force push to main branch",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "policy_bypass")).toBe(true)
    })
  })

  describe("destructive_change", () => {
    it("detects 'delete all'", () => {
      const matches = checkRules(
        "delete all files in the repo",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })

    it("detects 'rm -rf'", () => {
      const matches = checkRules("run rm -rf /", ALL_DISALLOWED_CATEGORIES)
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })

    it("detects 'drop database'", () => {
      const matches = checkRules(
        "drop database production",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })

    it("detects 'truncate table'", () => {
      const matches = checkRules(
        "truncate table users",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })

    it("detects 'format disk'", () => {
      const matches = checkRules(
        "format disk on the server",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })

    it("detects 'force-push to main'", () => {
      const matches = checkRules(
        "force-push to main to overwrite history",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })
  })

  describe("safe text", () => {
    it("produces no matches for normal bug report", () => {
      const matches = checkRules(
        "The login button does not work on mobile devices. Steps to reproduce: 1. Open the app 2. Tap login 3. Nothing happens",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.length).toBe(0)
    })

    it("produces no matches for normal feature request", () => {
      const matches = checkRules(
        "Add dark mode support to the settings page. Users should be able to toggle between light and dark themes.",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.length).toBe(0)
    })

    it("produces no matches for documentation task", () => {
      const matches = checkRules(
        "Update the README with installation instructions and add a contributing guide.",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.length).toBe(0)
    })

    it("produces no matches for 'Make a logo and add it to the README'", () => {
      const matches = checkRules(
        "Make a logo and add it to the README.",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.length).toBe(0)
    })

    it("produces no matches for 'Summarize what the project does'", () => {
      const matches = checkRules(
        "Summarize what the project does",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.length).toBe(0)
    })
  })

  describe("case insensitive matching", () => {
    it("matches uppercase 'REVERSE SHELL'", () => {
      const matches = checkRules(
        "INSTALL A REVERSE SHELL",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "malware")).toBe(true)
    })

    it("matches mixed case 'Delete All'", () => {
      const matches = checkRules(
        "Delete All the files",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "destructive_change")).toBe(
        true,
      )
    })

    it("matches mixed case 'Disable Branch Protection'", () => {
      const matches = checkRules(
        "Disable Branch Protection on main",
        ALL_DISALLOWED_CATEGORIES,
      )
      expect(matches.some((m) => m.category === "policy_bypass")).toBe(true)
    })
  })

  describe("category filtering", () => {
    it("only returns matches for requested categories", () => {
      const text = "install a reverse shell and delete all files"
      const matches = checkRules(text, ["malware"])
      expect(matches.every((m) => m.category === "malware")).toBe(true)
    })

    it("returns no matches when no categories requested", () => {
      const text = "install a reverse shell and delete all files"
      const matches = checkRules(text, [])
      expect(matches.length).toBe(0)
    })
  })

  describe("match sorting", () => {
    it("returns matches sorted by confidence descending", () => {
      const text =
        "install a reverse shell and also mention environment variable"
      const matches = checkRules(text, ALL_DISALLOWED_CATEGORIES)
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(
          matches[i].confidence,
        )
      }
    })
  })
})
