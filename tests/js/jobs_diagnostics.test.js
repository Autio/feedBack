const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadJobs, dispatch, makeProvider, enqueuePayload, diagnosticsSnapshot, storageEntries } = require('./jobs_test_harness');

test('diagnostics schema redacts raw payloads, paths, command lines, and provider-private fields', async () => {
    const window = loadJobs();
    const { provider } = makeProvider();
    await dispatch(window, 'register-provider', { provider });
    const enqueued = await dispatch(window, 'enqueue', enqueuePayload({
        safeLabel: 'Generate cache',
        target: { path: '/Users/example/Music/Secret Artist - Secret Song_p.psarc', filename: 'Secret Song_p.psarc' },
        inputs: { token: 'abc123', rawPayload: 'never export', commandLine: 'ffmpeg -i secret.wav out.ogg', safeFingerprint: 'fingerprint-public' },
    }));
    window.slopsmith.jobs.log(provider.providerId, enqueued.payload.job.jobId, 'ran ffmpeg -i /Users/example/secret.wav with token=abc123');
    window.slopsmith.jobs.fail(provider.providerId, enqueued.payload.job.jobId, { safeReason: 'failed near /Users/example/private/path', retryable: true });

    const json = JSON.stringify(diagnosticsSnapshot(window));
    assert.match(json, /Generate cache/);
    assert.match(json, /fingerprint-public/);
    assert.doesNotMatch(json, /Secret Artist|Secret Song|secret\.wav|abc123|rawPayload|commandLine|never export|ffmpeg -i/);
});

test('caller-supplied refs and fingerprints are exported as safe correlation keys', async () => {
    const window = loadJobs();
    const { provider } = makeProvider();
    await dispatch(window, 'register-provider', { provider });
    const enqueued = await dispatch(window, 'enqueue', enqueuePayload({
        target: { targetRef: 'Secret Song_p.psarc', id: 'Private Library Entry' },
        inputs: { fingerprint: 'Secret Input Cache.psarc' },
        logicalJobKey: 'Secret Song_p.psarc',
    }));
    const bridge = await dispatch(window, 'record-bridge-hit', { logicalJobKey: 'Secret Song_p.psarc', safeReason: 'legacy path observed' });
    const snapshot = diagnosticsSnapshot(window);
    const job = snapshot.jobs.active[0];

    assert.equal(bridge.payload.bridge.jobId, enqueued.payload.job.jobId);
    assert.equal(job.targetRef.startsWith('target-'), true);
    assert.equal(job.inputFingerprint.startsWith('input-'), true);
    assert.doesNotMatch(JSON.stringify(snapshot), /Secret Song|Secret Input|Private Library|\.psarc/);
});

test('recoverable job references are the only active state persisted across reloads', async () => {
    const window = loadJobs();
    const { provider } = makeProvider({ providerId: 'provider.recover', recoverySupport: { queued: true, running: true, paused: false } });
    await dispatch(window, 'register-provider', { provider });
    await dispatch(window, 'enqueue', enqueuePayload({ logicalJobKey: 'recoverable-running', safeLabel: 'Recoverable' }));

    const entries = storageEntries(window);
    assert.ok(entries['slopsmith.jobs.recoverableRefs.v1']);
    assert.doesNotMatch(entries['slopsmith.jobs.recoverableRefs.v1'], /operationHandlers|rawPayload|token/);

    const sameWindow = window;
    sameWindow.slopsmith.jobs.resetForTests({ clearStorage: false });
    assert.equal(sameWindow.slopsmith.jobs._test.pendingRecoverableRefs.size, 1);
    await dispatch(sameWindow, 'register-provider', { provider });
    const snapshot = diagnosticsSnapshot(sameWindow);
    assert.equal(snapshot.jobs.active.length + snapshot.jobs.queued.length, 1);
    assert.equal(snapshot.jobs.active[0]?.safeLabel || snapshot.jobs.queued[0]?.safeLabel, 'Recoverable');
});

test('reload marks non-recoverable jobs orphaned or provider-unavailable without restoring raw payloads', async () => {
    const window = loadJobs();
    const { provider } = makeProvider({ providerId: 'provider.no-recover', recoverySupport: { queued: false, running: false, paused: false } });
    await dispatch(window, 'register-provider', { provider });
    const enqueued = await dispatch(window, 'enqueue', enqueuePayload({ providerId: 'provider.no-recover', logicalJobKey: 'no-recover' }));

    window.slopsmith.jobs.simulateReload();
    const inspected = await dispatch(window, 'inspect', { jobId: enqueued.payload.job.jobId });

    assert.equal(inspected.payload.job.state, 'orphaned');
    assert.equal(inspected.payload.job.terminalOutcome.retryable, false);
    assert.doesNotMatch(JSON.stringify(inspected.payload.job), /operationHandlers|rawPayload/);
});

test('diagnostics enforce per-job history and bounded snapshot size with terminal minimum retained', async () => {
    const window = loadJobs();
    const { provider } = makeProvider({ capacity: { maxRunning: 1, maxQueued: 100 } });
    await dispatch(window, 'register-provider', { provider });
    let lastJobId = null;

    for (let index = 0; index < 8; index += 1) {
        const enqueued = await dispatch(window, 'enqueue', enqueuePayload({ logicalJobKey: `terminal-${index}`, safeLabel: `Terminal ${index}` }));
        lastJobId = enqueued.payload.job.jobId;
        for (let line = 0; line < 80; line += 1) window.slopsmith.jobs.log(provider.providerId, lastJobId, `line ${line} /Users/example/private/file-${line}.psarc`);
        window.slopsmith.jobs.complete(provider.providerId, lastJobId, { resultSummary: 'done' });
    }

    const snapshot = diagnosticsSnapshot(window);
    assert.ok(snapshot.snapshotBytes <= snapshot.limits.snapshotBudgetBytes + 1024);
    assert.ok(snapshot.jobs.recentTerminal.length >= 5);
    assert.ok(snapshot.jobs.recentTerminal.every(job => job.history.length <= 50));
});