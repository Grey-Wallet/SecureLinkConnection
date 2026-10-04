# Release tooling

This monorepo uses [Changesets](https://github.com/changesets/changesets).

```bash
pnpm changeset          # describe a change
pnpm version-packages   # bump versions
pnpm release            # build + npm publish
```

Set `NPM_TOKEN` in GitHub Actions secrets for CI publish.
