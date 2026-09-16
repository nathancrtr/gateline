<!-- Note: gateline is maintainer-authored until a contribution policy (CLA/DCO)
     lands — see CONTRIBUTING.md. Outside PRs will be read and credited, but
     the substance should live in an issue. -->

**What this changes and why**

**Checklist**
- [ ] `gateline render --check` passes (rendered agents current)
- [ ] No vendor or model names in `roles/` or `contracts/`
- [ ] `packages/framework` still takes no runtime dependencies
- [ ] Tests pass: `npm test` in `packages/` (add `npm run typecheck` and
      `npm run lint` when you touch the workspace)
- [ ] No retro-edits to completed runs under `runs/`
