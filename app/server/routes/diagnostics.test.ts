import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnosticsEntries } from './diagnostics';

describe('diagnosticsEntries', () => {
  let dataDir: string;

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('never includes the database, password hash, session secret or agent token, even when they sit right next to the known files', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-diagnostics-test-'));
    // Secrets an attacker (or a careless refactor) might hope get swept up alongside the real diagnostics.
    fs.writeFileSync(path.join(dataDir, 'studio.db'), 'sqlite-bytes');
    fs.writeFileSync(path.join(dataDir, 'password.json'), '{"salt":"x","hash":"y"}');
    fs.writeFileSync(path.join(dataDir, 'session-secret.txt'), 'shh');
    fs.writeFileSync(path.join(dataDir, 'agent-token'), 'agent-secret');
    // The known, safe files the archive is allowed to read.
    fs.writeFileSync(path.join(dataDir, 'milestones.json'), '{"podStartedAt":"2026-01-01T00:00:00.000Z"}');
    fs.writeFileSync(path.join(dataDir, 'gpu-check.json'), '{"ok":true}');
    fs.mkdirSync(path.join(dataDir, 'logs'));
    fs.writeFileSync(path.join(dataDir, 'logs', 'server.log'), 'listening on :3000');
    const modelsStatusFile = path.join(dataDir, 'models-status.json');
    fs.writeFileSync(modelsStatusFile, '{"groups":[]}');

    const entries = diagnosticsEntries({ dataDir, modelsStatusFile, systemInfo: { version: '0.1.0' } });
    const names = entries.map((e) => e.name);
    const srcs = entries.map((e) => e.src).filter(Boolean) as string[];

    for (const forbidden of ['studio.db', 'password.json', 'session-secret.txt', 'agent-token']) {
      expect(names).not.toContain(forbidden);
      expect(srcs.some((s) => s.endsWith(forbidden))).toBe(false);
    }

    expect(names).toEqual(expect.arrayContaining(['README.txt', 'milestones.json', 'gpu-check.json', 'system.json', 'models-status.json', 'logs/server.log']));
  });

  it('skips files that are missing instead of throwing', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-diagnostics-test-'));
    const entries = diagnosticsEntries({ dataDir, modelsStatusFile: path.join(dataDir, 'models-status.json'), systemInfo: {} });
    const names = entries.map((e) => e.name);
    expect(names).toEqual(['README.txt', 'system.json']);
  });
});
