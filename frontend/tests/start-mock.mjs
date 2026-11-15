// Shell-free Python launch works in local Windows/POSIX virtualenvs and in CI.
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const backend = fileURLToPath(new URL('../../backend/', import.meta.url))
const venv = path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = process.env.E2E_PYTHON || (existsSync(venv) ? venv : 'python')
const child = spawn(python, ['-m', 'uvicorn', 'preview:app', '--app-dir', 'tests', '--host', '127.0.0.1', '--port', '18001'], {
  cwd: backend, stdio: 'inherit', shell: false,
})
child.on('error', error => { console.error(`Cannot start mock backend: ${error.message}`); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
