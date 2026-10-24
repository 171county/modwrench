// node:perf_hooks in the browser build: the browser's own clock, which the redactor's time allowance reads.
export const performance = globalThis.performance;
