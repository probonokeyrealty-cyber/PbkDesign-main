# Staff Command Center releases

The staff site, `pbkcenter`, builds GitHub `main` on Netlify. For that exact Netlify project, the production build now checks signed-out Home, Leads, and Settings before and after the application build. All three must return HTTP 401. Separate projects and non-production build contexts keep their existing build commands.

The **Staff Release Privacy** GitHub workflow runs the same checker and tests a simulated public site without any publishing credentials. Keep team sign-in enabled for staff production and previews. Netlify permissions still control direct uploads. Review project-specific Developer and Publisher assignments before relying on owners-only manual publication.

**Claude Staff Release Review** is an optional, manually dispatched review for open pull requests against `main`. It sends only the public pull request diff to Claude and writes feedback to the Actions summary. Configure `ANTHROPIC_API_KEY` in the `staff-claude-review` GitHub environment. Limit that environment to `main`. Claude has no deployment or merge authority.
