import { runAll } from './harness'
import './cases/camera.test'
import './cases/drive.test'
import './cases/track.test'
import './cases/shortcut.test'
import './cases/lap.test'
import './cases/ai.test'
import './cases/fx.test'
import './cases/ui.test'
import './cases/perf.test'
import './cases/assets.test'
import './cases/community.test'
import './cases/policy-entry.test'
import './cases/governance.test'
import './cases/workflows.test'

const ok = await runAll()
process.exit(ok ? 0 : 1)
