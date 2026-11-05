# Documentation conventions

TSDoc comments describe the contracts of TypeScript declarations. TypeDoc turns those comments into a locally browsable HTML API reference. The reference follows the package's two entry points: `react-socket-link` and `react-socket-link/core`.

## Public API comments

Add a `/** ... */` comment to every consumer-facing export and to properties or methods whose behavior, defaults, or constraints matter. Explain what callers can observe: ownership, cleanup, errors, retries, and whether a return value is an acknowledgement. Keep message type descriptions and examples consistent with the implementation and tests. Comments on declarations reached only through an internal module are useful for maintainers but do not make those declarations package exports.

Use tags only when they add information:

| Tag | Use |
| --- | --- |
| `@remarks` | Lifecycle, side effects, constraints, or architectural context beyond the summary. |
| `@param`, `@returns` | Meaningful argument and result behavior, especially units or outcomes. |
| `@typeParam` | What a generic message type or discriminator represents. |
| `@example` | Short, realistic use of a complex public API. |
| `@defaultValue` | A default verified in the implementation. |
| `@throws` | Synchronous throws or rejected promises callers can handle. |
| `@see` | A related declaration or stable external reference. |
| `@deprecated` | Only an actual deprecated contract, with a replacement. |
| `@public` | Only when an explicit visibility annotation helps clarify an intentional package export. |
| `@internal` | Implementation-only declarations; TypeDoc excludes them. |

### Function

~~~ts
/**
 * Creates a reusable protocol identity without opening a connection.
 *
 * @param name - Nonempty label used in registration errors.
 * @returns A definition that can be shared by registrations and hooks.
 * @throws If the name is empty or whitespace.
 */
~~~

### Interface

~~~ts
/**
 * Options for a retry policy.
 */
interface RetryOptions {
  /**
   * Maximum number of retries.
   * @defaultValue Infinity
   */
  maxAttempts?: number;
}
~~~

### React hook

~~~ts
/**
 * Reads a provider-owned socket view.
 *
 * @remarks Requires a provider that registered the same definition object.
 * @param definition - Definition registered by the nearest provider.
 * @returns A shared view without lifecycle controls.
 * @throws If the provider or registration is missing.
 */
~~~

## Internal comments

Document non-obvious state transitions, ownership, transport replacement, and cleanup near the relevant declaration. Skip trivial helpers and implementation restatements. Use `@internal` only when a declaration is truly implementation-only.

## Local workflow

Run `npm run docs:check` to convert and validate without writing output. Run `npm run docs:generate`, then open `docs/api/index.html` in a browser to inspect the reference. Review links, examples, defaults, and exported symbols whenever an API changes. Update the source comment in the same change as the API or behavior.
