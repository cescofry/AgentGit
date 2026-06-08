#!/usr/bin/env node

import { setupRepo } from "./repo"
import { setupServer } from "./server"
import { runDoctor } from "./doctor"

async function main() {
  const args = process.argv.slice(2)
  const command = args.join(" ")

  switch (command) {
    case "setup repo": {
      console.log("Running repository setup...\n")

      const owner = process.env.AGENTGIT_OWNER
      const repo = process.env.AGENTGIT_REPO

      if (!owner || !repo) {
        console.error(
          "Error: AGENTGIT_OWNER and AGENTGIT_REPO environment variables must be set.",
        )
        process.exit(1)
      }

      // Placeholder octokit - in production this would be created from env credentials
      console.error(
        "Error: Repo setup requires a configured Octokit instance. " +
          "Use the programmatic API or ensure GitHub App credentials are set.",
      )
      process.exit(1)
      break
    }

    case "setup server": {
      console.log("Checking server environment...\n")
      const result = await setupServer()

      for (const check of result.checks) {
        const icon =
          check.status === "ok" ? "+" : check.status === "warn" ? "!" : "x"
        const details = check.details ? ` - ${check.details}` : ""
        console.log(`  [${icon}] ${check.check}${details}`)
      }

      console.log()
      if (result.success) {
        console.log("Server environment is ready.")
      } else {
        console.log("Server environment has issues. Fix the errors above.")
        process.exit(1)
      }
      break
    }

    case "doctor": {
      console.log("Running health checks...\n")
      const result = await runDoctor({
        localPath: process.cwd(),
      })

      for (const section of result.sections) {
        console.log(`${section.name}:`)
        for (const check of section.checks) {
          const icon =
            check.status === "ok" ? "+" : check.status === "warn" ? "!" : "x"
          const details = check.details ? ` - ${check.details}` : ""
          console.log(`  [${icon}] ${check.name}${details}`)
        }
        console.log()
      }

      console.log(
        `Results: ${result.totalPassed} passed, ${result.totalWarnings} warnings, ${result.totalFailed} failed`,
      )
      process.exit(result.exitCode)
      break
    }

    default:
      console.log("Usage: agentgit <setup repo|setup server|doctor>")
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
