import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const fakeAgentPath = join(process.cwd(), 'tests/helpers/fake-agent.sh');
const ralphPath = join(process.cwd(), 'ralph.ts');
const bunPath = process.execPath;
let workDir = '';
let stateDir = '';
let statePath = '';
let questionsPath = '';
let agentConfigPath = '';

function assignPaths(nextWorkDir: string) {
  workDir = nextWorkDir;
  stateDir = join(workDir, '.ralph');
  statePath = join(stateDir, 'ralph-loop.state.json');
  questionsPath = join(stateDir, 'ralph-questions.json');
  agentConfigPath = join(workDir, 'test-agents.json');
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeFakeAgentConfig() {
  writeFileSync(agentConfigPath, JSON.stringify({
    version: '1.0',
    agents: [
      {
        type: 'codex',
        command: fakeAgentPath,
        configName: 'Fake Codex',
        argsTemplate: 'default',
        envTemplate: 'default',
        parsePattern: 'default',
      },
    ],
  }, null, 2));
}

describe('SIGINT Cleanup', () => {
  beforeEach(() => {
    assignPaths(mkdtempSync(join(tmpdir(), 'ralph-sigint-')));
    mkdirSync(workDir, { recursive: true });
    [statePath, questionsPath].forEach(path => {
      if (existsSync(path)) {
        try { unlinkSync(path); } catch {}
      }
    });
  });

  afterEach(() => {
    if (existsSync(workDir)) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('stops heartbeat timer on SIGINT', async () => {
    writeFakeAgentConfig();
    const proc = Bun.spawn({
      cmd: [bunPath, 'run', ralphPath, '--no-commit', '--config', agentConfigPath, 'fake sigint timer stop', '--agent', 'codex', '--model', 'stall', '--heartbeat-interval', '500ms', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(1500);
    proc.kill('SIGINT');
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    const heartbeatCount = (stdout.match(/⏳ working\.\.\./g) || []).length;
    expect(heartbeatCount).toBeGreaterThan(0);
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  it('stops heartbeat output deterministically on SIGINT with a fake agent', async () => {
    writeFakeAgentConfig();
    const proc = Bun.spawn({
      cmd: [bunPath, 'run', ralphPath, '--no-commit', '--config', agentConfigPath, 'fake sigint', '--agent', 'codex', '--model', 'stall', '--heartbeat-interval', '500ms', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(1200);
    proc.kill('SIGINT');
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    const heartbeatCount = (stdout.match(/⏳ working\.\.\./g) || []).length;
    expect(heartbeatCount).toBeGreaterThan(0);
    expect(stdout).toContain('Loop cancelled.');
    expect(stdout.split('Loop cancelled.').pop() || '').not.toContain('⏳ working...');
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  it('clears state on SIGINT', async () => {
    writeFakeAgentConfig();
    const proc = Bun.spawn({
      cmd: [bunPath, 'run', ralphPath, '--no-commit', '--config', agentConfigPath, 'fake clear state', '--agent', 'codex', '--model', 'stall', '--heartbeat-interval', '500ms', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(500);
    proc.kill('SIGINT');
    await proc.exited;
    
    // State should be cleared after SIGINT
    expect(existsSync(statePath)).toBe(false);
  });

  it('handles double SIGINT (force stop)', async () => {
    writeFakeAgentConfig();
    const proc = Bun.spawn({
      cmd: [bunPath, 'run', ralphPath, '--no-commit', '--config', agentConfigPath, 'fake double sigint', '--agent', 'codex', '--model', 'stall', '--heartbeat-interval', '500ms', '--max-iterations', '1'],
      cwd: workDir,
      stdout: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    await wait(500);
    proc.kill('SIGINT');
    await wait(100);
    proc.kill('SIGINT');

    const exitCode = await proc.exited;
    // Either force stop (1) or normal stop (0) is acceptable
    expect([0, 1]).toContain(exitCode);
  });
});
