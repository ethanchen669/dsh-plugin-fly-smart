/**
 * Test isolation for the smart packages: **never touch the real `~/.dsh-fly`**.
 *
 * Two separate surfaces have to move, and moving only one is the trap the
 * acceptance calls out (`acceptance.md` M1/M17):
 *
 *   - `HOME` moves the **legacy task root** (`~/.dsh-fly/smart`) and the default
 *     mirror location, because `os.homedir()` reads `$HOME` on POSIX;
 *   - `DSH_FLY_SMART_ROUTES` moves the **mirror file** to an explicit scratch path,
 *     which is what a spec that writes routes must use — and the assertions check
 *     the real `~/.dsh-fly/smart-routes.json` is byte-identical afterwards.
 *
 * Importing this module for its side effects is enough; import it first in every
 * spec of both packages.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A scratch home, outside the repo (hard rule 3). */
export const SCRATCH_HOME = mkdtempSync(join(tmpdir(), 'fly-smart-home-'))

process.env.HOME = SCRATCH_HOME
process.env.USERPROFILE = SCRATCH_HOME

/** The scratch mirror file every write test uses. */
export const SCRATCH_MIRROR = join(SCRATCH_HOME, 'mirror', 'smart-routes.json')

process.env.DSH_FLY_SMART_ROUTES = SCRATCH_MIRROR

/** The scratch legacy root (`$HOME/.dsh-fly/smart`). */
export const SCRATCH_LEGACY = join(SCRATCH_HOME, '.dsh-fly', 'smart')
