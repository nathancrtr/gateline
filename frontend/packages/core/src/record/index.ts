// The run-record layer: the state.yaml data model, contract well-formedness,
// and the decision actions that mutate the record. This layer is the evidence
// kernel — it may not import from sources/ or view-model/ (see
// test/layering.test.ts), so it stays extractable on its own.
export * from './schema.ts'
export * from './validate.ts'
export * from './actions.ts'
export * from './scaffold.ts'
