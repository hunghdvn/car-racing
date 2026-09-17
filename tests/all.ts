import { runAll } from './harness'
import './cases/drive.test'
import './cases/track.test'
import './cases/lap.test'

const ok = await runAll()
process.exit(ok ? 0 : 1)
