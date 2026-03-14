# /release - Publish a new version to npm

## Description
Bump the package version, push to GitHub, and create a release that triggers the npm publish workflow.

## Instructions

Before prompting the user, do the following:

1. Read the current version from `package.json`.
2. Run `git log $(git describe --tags --abbrev=0)..HEAD --oneline` to see what's changed since the last release.
3. Based on the changes, decide your recommended version bump:
   - **patch** — bug fixes, typos, small tweaks
   - **minor** — new features, non-breaking enhancements
   - **major** — breaking changes, API changes, large rewrites
4. Calculate what the new version number would be for each option (patch, minor, major).

Then use the `AskUserQuestion` tool to present three options ordered by your recommendation (first = recommended, last = least likely). Each option should show the bump type and the resulting version number, e.g. "patch (0.1.0 → 0.1.1)". Add "(Recommended)" to the first option's label.

Then run the following steps:

1. Run `npm version <patch|minor|major>` to bump `package.json` and create a git tag.
2. Run `git push && git push --tags` to push the commit and tag.
3. Run `gh release create v<new-version> --generate-notes` to create a GitHub Release.

The GitHub Release triggers `.github/workflows/publish.yml`, which builds and publishes to npm via Trusted Publishing.

Tell the user the new version number and link to the release when done.
