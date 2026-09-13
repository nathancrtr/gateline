<!-- Note: gateline is maintainer-authored until a contribution policy (CLA/DCO)
     lands — see CONTRIBUTING.md. Outside PRs will be read and credited, but
     the substance should live in an issue. -->

**What this changes and why**

**Checklist**
- [ ] `python3 scripts/render-agents.py --check` passes (rendered agents current)
- [ ] No vendor or model names in `roles/` or `contracts/`
- [ ] Vendored tooling stays stdlib-only, Python 3.11-compatible
- [ ] Tests pass: `pytest scripts/test_integrate.py` (and `npm test` in
      `packages/` if it's touched)
- [ ] No retro-edits to completed runs under `runs/`
