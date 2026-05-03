import { addTestOnlyListener } from 'backend/ipc'
import { RunnerCommandStub } from 'common/types'

const defaultStubs: RunnerCommandStub[] = [
  {
    commandParts: ['--version'],
    stdout: 'maxima-cli 0.1.0'
  }
]

let currentStubs = [...defaultStubs]

export const runEACommandStub = async (command: string[]) => {
  const stub = currentStubs.find((stub) =>
    stub.commandParts.every((part) => command.includes(part))
  )

  if (stub?.response) return stub.response

  return Promise.resolve({
    stdout: stub?.stdout || '',
    stderr: stub?.stderr || ''
  })
}

addTestOnlyListener('setEACommandStub', (stubs) => (currentStubs = [...stubs]))
addTestOnlyListener(
  'resetEACommandStub',
  () => (currentStubs = [...defaultStubs])
)
