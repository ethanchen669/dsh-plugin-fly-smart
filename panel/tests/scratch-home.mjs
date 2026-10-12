/**
 * Test isolation for the smart workbench: **never read or write the real
 * `~/.dsh-fly/`**.
 *
 * Three surfaces move here, and moving fewer than all of them is the trap the
 * acceptance names (`acceptance.md` M1/M17):
 *
 *   - `HOME` moves the **legacy task root** (`~/.dsh-fly/smart`), because
 *     `os.homedir()` reads `$HOME` on POSIX;
 *   - `DSH_FLY_SMART_ROOT` is the panel half's task-root override (a verify boot
 *     uses it; specs pass `env` explicitly instead);
 *   - `DSH_FLY_SMART_ROUTES` moves the **mirror file** — the one file that must
 *     never be touched for real, so its bytes are captured here and re-checked by
 *     the last test in the suite.
 *
 * Import this first, for its side effects.
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** The developer's real home, captured before it is redirected. */
export const REAL_HOME = homedir()

/** The developer's real mirror — read for a before/after byte check, never written. */
export const REAL_MIRROR = join(REAL_HOME, '.dsh-fly', 'smart-routes.json')

/** The real mirror's bytes at module load, or null when it does not exist. */
export const REAL_MIRROR_BYTES = (() => {
  try {
    return readFileSync(REAL_MIRROR)
  } catch {
    return null
  }
})()

/** A scratch home, outside the repo (hard rule 3). */
export const SCRATCH_HOME = mkdtempSync(join(tmpdir(), 'fly-smart-panel-home-'))

process.env.HOME = SCRATCH_HOME
process.env.USERPROFILE = SCRATCH_HOME

/** The scratch mirror file every write test uses. */
export const SCRATCH_MIRROR = join(SCRATCH_HOME, 'mirror', 'smart-routes.json')

process.env.DSH_FLY_SMART_ROUTES = SCRATCH_MIRROR
