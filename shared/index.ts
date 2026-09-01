/**
 * Code shared by every add-on in this repo. Import it with the `@shared` alias:
 *
 * ```ts
 * import { createLogger } from '@shared/log';
 * ```
 *
 * The build bundles shared modules into each add-on, so there is no runtime
 * dependency between packs.
 */
export * from './chat';
export * from './log';
