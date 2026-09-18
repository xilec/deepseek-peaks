import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The one place that turns the two repository sources into text that can be pasted into a
 * JavaScript scope which cannot `import`. Two artifacts share it: the body of the dynamic
 * Cordis Package (transcribed by hand, so comments are dropped) and the browser bundle of
 * the installable package (a real file, so comments are kept).
 */

const here = dirname(fileURLToPath(import.meta.url))
export const root = join(here, '..')

/** Remove ESM import statements. */
export function stripImports(source) {
  return source.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*$/gm, '')
}

/** Turn `export const/function` into plain declarations: these scopes have no exports. */
export function stripExports(source) {
  return source.replace(/^export\s+/gm, '')
}

/**
 * Drop comment-only lines. Only lines that *begin* a comment are removed, so a `//`
 * inside a string (the rule's source URL) survives untouched.
 */
export function stripCommentLines(source) {
  const kept = []
  let inBlock = false
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      continue
    }
    if (trimmed.startsWith('//')) continue
    kept.push(line)
  }
  return kept.join('\n')
}

/**
 * Read both sources in the form an import-less scope needs.
 * @param options.stripComments - drop comment-only lines (for the hand-transcribed body).
 * @returns the prepared core and client sources.
 */
export function readInlined({ stripComments = false } = {}) {
  const prepare = (file) => {
    const withoutSyntax = stripExports(stripImports(readFileSync(join(root, 'src', file), 'utf8')))
    return stripComments ? stripCommentLines(withoutSyntax) : withoutSyntax
  }
  return { core: prepare('peaks-core.mjs'), client: prepare('client.mjs') }
}
