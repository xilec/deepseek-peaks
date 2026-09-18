/**
 * Host half of a packaged install.
 *
 * The indicator is browser-only: every decision it makes is a client decision (the
 * session's route, the browser clock, the reader's zone). This entry exists so the
 * package has the shape a profile expects — `main` for the Host loader and `./client`
 * for the browser loader — and contributes nothing on the Host.
 */
export function apply() {}
