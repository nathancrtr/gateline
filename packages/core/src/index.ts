// Layered on purpose: record (the evidence kernel) ← sources (where records
// live) ← view-model (what the frontend renders). Import a single layer via
// the package subpaths (@gateline/core/record, /sources, /view-model); this
// root export remains the whole package.
export * from './record/index.ts'
export * from './sources/index.ts'
export * from './view-model/index.ts'
