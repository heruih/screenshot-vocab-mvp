import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const repoUrl = 'https://github.com/heruih/screenshot-vocab-mvp.git';
const siteUrl = 'https://heruih.github.io/screenshot-vocab-mvp/';
const reviewUrl = 'https://api.simonnotes.xyz/v1/dialogue/review';
const siteOrigin = new URL(siteUrl).origin;
const root = fileURLToPath(new URL('../', import.meta.url));
const netGit = ['-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=20'];
const initialRelease = {
  pages: '272472a90ea82259b60f5c4c0cb373876c2e6608',
  source: '13225082686d5afc33d98163929db60ffa77e76f',
  worker: 'b50a77d0-20ce-475b-b176-94e10a89a789',
};
const pagesFiles = ['index.html', 'sw.js', 'manifest.webmanifest', 'icons', 'guide-assets'];
const regionEngine = 'ocr-assets/ocr-engine-region-v1.mjs';
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' };

function command(executable, args, cwd, options = {}) {
  const result = spawnSync(executable, args, {
    cwd, env: options.env ?? process.env, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: options.timeout ?? 120_000,
    maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw new Error(executable + '：' + result.error.message);
  const output = result.stdout.trim();
  if (result.status !== 0) {
    if (!options.quiet) process.stderr.write(result.stderr || result.stdout);
    throw new Error(executable + ' 操作失败（退出码 ' + result.status + '）');
  }
  return output;
}

function git(args, cwd = root) {
  return command('git', args, cwd, { env: gitEnv });
}

export function releaseChanges(files) {
  return {
    website: files.some(file => file.startsWith('src/') || file === 'scripts/build.mjs' ||
      file === 'scripts/prepare-ocr-engine.mjs'),
    worker: files.some(file => file === 'wrangler-relay.toml' ||
      file === 'relay/english-notes-relay-worker.js' || file.startsWith('relay/entitlements/')),
    migration: files.some(file => file === 'relay/entitlements/schema.sql' ||
      file.startsWith('relay/entitlements/migrations/')),
    ocr: files.some(file => file.startsWith('_engine/')),
  };
}

export function deployedRelease(pages, message) {
  if (pages === initialRelease.pages) return initialRelease;
  const source = message.match(/^Release-Source: ([a-f0-9]{40})$/m)?.[1];
  const worker = message.match(/^Release-Worker: ([a-f0-9-]{36})$/m)?.[1];
  assert(source && worker, '正式发布分支缺少源码或后端记录，请先核对线上版本。');
  return { pages, source, worker };
}

function remoteHeads(remote) {
  const entries = git([...netGit, 'ls-remote', '--heads', remote,
    'refs/heads/main', 'refs/heads/gh-pages']);
  const refs = new Map(entries.split(/\r?\n/).map(line => line.split('\t').reverse()));
  return { source: refs.get('refs/heads/main'), pages: refs.get('refs/heads/gh-pages') };
}

function wrangler(args, cwd, logPath) {
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: logPath };
  const flags = [...args, '--config', 'wrangler-relay.toml'];
  const options = { env, timeout: 180_000 };
  if (process.env.SVOCAB_WRANGLER_JS) {
    return command(process.execPath, [process.env.SVOCAB_WRANGLER_JS, ...flags], cwd, options);
  }
  const npmArgs = ['--yes', 'wrangler@4.169.0', ...flags];
  return process.platform === 'win32'
    ? command(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npx.cmd', ...npmArgs], cwd, options)
    : command('npx', npmArgs, cwd, options);
}

function activeWorker(cwd, log) {
  const deployments = JSON.parse(wrangler(['deployments', 'list', '--json'], cwd, log));
  const latest = deployments.toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  assert(latest?.versions?.length === 1 && latest.versions[0].percentage === 100,
    '后端当前不是单版本全流量部署，请先核对 Cloudflare。');
  return latest.versions[0].version_id;
}

async function reviewSmokeTest() {
  const [preflight, anonymous] = await Promise.all([
    fetch(reviewUrl, { method: 'OPTIONS', signal: AbortSignal.timeout(15_000),
      headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type' } }),
    fetch(reviewUrl, { method: 'POST', body: '{}', signal: AbortSignal.timeout(15_000),
      headers: { Origin: siteOrigin, 'Content-Type': 'application/json' } }),
  ]);
  assert.equal(preflight.status, 204, '批改接口预检状态异常');
  assert.equal(preflight.headers.get('access-control-allow-origin'), siteOrigin, '批改接口来源异常');
  assert.equal(anonymous.status, 401, '未登录的批改请求状态异常');
}

async function retry(check) {
  let error;
  for (const delay of [0, 3000, 8000, 14000]) {
    await wait(delay);
    try {
      return await check();
    } catch (failure) {
      error = failure;
    }
  }
  throw error;
}

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function verifyWebsite(pagesDir, commit) {
  await Promise.all(['index.html', 'sw.js'].map(async file => {
    const expected = checksum(await readFile(join(pagesDir, file)));
    await retry(async () => {
      const url = new URL(file === 'index.html' ? './' : file, siteUrl);
      url.searchParams.set('release', commit);
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
      assert(response.ok, file + ' 线上 HTTP ' + response.status);
      assert.equal(checksum(Buffer.from(await response.arrayBuffer())), expected, file + ' 线上文件不一致');
    });
  }));
}

async function release(args) {
  assert(args.length <= 1 && [undefined, '--dry-run', '--publish'].includes(args[0]),
    '运行 node scripts/release-commercial.mjs [--dry-run | --publish]');
  const publish = args[0] === '--publish';
  const remotes = git(['remote']).split(/\r?\n/);
  const remote = remotes.find(name => git(['remote', 'get-url', name]) === repoUrl &&
    git(['remote', 'get-url', '--push', name]) === repoUrl);
  assert(remote, '找不到指向商业版 GitHub 的 HTTPS 远端。');

  const baseRefs = ['refs/svocab-release/main', 'refs/svocab-release/gh-pages'];
  git([...netGit, 'fetch', '--no-tags', remote, '+refs/heads/main:' + baseRefs[0],
    '+refs/heads/gh-pages:' + baseRefs[1]]);
  const [source, pages] = git(['rev-parse', ...baseRefs]).split(/\r?\n/);
  const before = deployedRelease(pages, git(['log', '-1', '--format=%B', pages]));
  git(['merge-base', '--is-ancestor', before.source, source]);
  const files = git(['diff', '--name-only', '--no-renames', '-z', before.source, source]).split('\0');
  const changes = releaseChanges(files);

  console.log(publish ? '正式发布' : '发布演练');
  console.log('GitHub 源码：' + source);
  console.log('网页回退点：' + pages);
  console.log('后端回退点：' + before.worker + (publish ? '' : '（来自发布记录）'));
  const workerStep = changes.worker ? '先部署并验证后端' : '复用当前后端';
  const pagesStep = changes.website || changes.worker ? '构建并发布网页' : '无产品变更';
  console.log('计划：' + workerStep + ' → ' + pagesStep);
  if (changes.migration) console.log('数据库结构有变动，需要单独确认迁移和恢复。');
  if (changes.ocr) console.log('OCR 引擎源码有变动，需要单独构建并验证引擎。');
  if (publish) {
    assert(!changes.migration && !changes.ocr, '此次变更需要独立发布步骤，请先确认。');
    if (!changes.website && !changes.worker) return;
    if (changes.worker) {
      assert(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID,
        '需要在发布环境设置 Cloudflare 专用部署凭证。');
    }
  }

  const temp = await mkdtemp(join(await realpath(tmpdir()), 'svocab-release-'));
  const sourceDir = join(temp, 'source');
  const pagesDir = join(temp, 'pages');
  const logPath = join(temp, 'wrangler.log');
  const created = [];
  function checkout(dir, commit) {
    git(['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', dir, commit]);
    created.push(dir);
  }
  let operation = '准备独立构建目录';
  try {
    checkout(sourceDir, source);
    checkout(pagesDir, pages);
    const output = join(sourceDir, 'dist', 'pages');
    await mkdir(output, { recursive: true });
    await cp(join(pagesDir, 'ocr-assets'), join(output, 'ocr-assets'), { recursive: true });

    operation = '构建与回归';
    console.log(command(process.execPath, ['scripts/build.mjs', '--product=commercial', '--pages'], sourceDir));
    const bundle = [...pagesFiles, regionEngine];
    for (const file of bundle) {
      await cp(join(output, file), join(pagesDir, file), { recursive: true });
    }
    const review = command(process.execPath, ['scripts/test-review-round.mjs'], sourceDir);
    console.log('复习回归：' + review.split(/\r?\n/).findLast(line => line.startsWith('结果：')));
    if (changes.worker || !publish) {
      const entitlements = command(process.execPath, ['--experimental-sqlite',
        'scripts/test-entitlements-simulate.mjs'], sourceDir);
      console.log('权益回归：' + entitlements.split(/\r?\n/).findLast(line => line.startsWith('结果：')));
    }
    if (!publish) {
      console.log('演练通过。已生成并检查商业版网页与 OCR 资源。');
      return;
    }

    operation = '检查 GitHub 发布权限和版本';
    const expected = { source, pages };
    assert.deepEqual(remoteHeads(remote), expected, 'GitHub 分支已有更新，请重新演练。');
    const refspec = 'HEAD:refs/heads/gh-pages';
    const pageMessage = '[codex] 发布截图词库 ' + source.slice(0, 7);
    const commit = ['-c', 'user.name=Codex', '-c', 'user.email=codex@users.noreply.github.com', 'commit'];
    const versionMessage = worker => 'Release-Source: ' + source + '\nRelease-Worker: ' + worker;
    git(['-c', 'core.autocrlf=false', 'add', '--', ...bundle], pagesDir);
    git([...commit, '-m', pageMessage, '-m', versionMessage(before.worker)], pagesDir);
    git([...netGit, 'push', '--dry-run', remote, refspec], pagesDir);

    let worker = before.worker;
    if (changes.worker) {
      operation = '检查后端回退点';
      assert.equal(activeWorker(sourceDir, logPath), before.worker,
        '线上后端与上次发布记录不符，请先核对。');
      operation = '部署后端';
      const deployment = wrangler(['deploy', '--keep-vars'], sourceDir, logPath);
      worker = deployment.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1];
      assert(worker, '后端部署完成后未取得版本号，请核对当前流量。');
      console.log('部署后的 Worker：' + worker);
      operation = '确认后端版本和批改接口';
      await retry(async () => {
        assert.equal(activeWorker(sourceDir, logPath), worker, 'Worker 尚未接管全部流量');
        await reviewSmokeTest();
      });
      operation = '补记新后端版本';
      git([...commit, '--amend', '-m', pageMessage, '-m', versionMessage(worker)], pagesDir);
    }

    operation = '推送网页';
    assert.deepEqual(remoteHeads(remote), expected, 'GitHub 分支已有更新，请先核对。');
    const published = git(['rev-parse', 'HEAD'], pagesDir);
    git([...netGit, 'push', remote, refspec], pagesDir);
    console.log('网页已推送：' + published);
    operation = '核对正式首页和缓存脚本';
    await verifyWebsite(pagesDir, published);
    console.log('正式版已核对：' + siteUrl);
  } catch (error) {
    throw new Error(operation + '：' + error.message);
  } finally {
    try {
      for (const dir of created.reverse()) {
        assert.equal(await realpath(dir), dir, '临时工作目录路径发生变化');
        git(['worktree', 'remove', '--force', dir]);
      }
      assert.equal(await realpath(temp), temp, '临时目录路径发生变化');
      await rm(temp, { recursive: true, force: true });
    } catch (error) {
      console.warn('临时目录回收失败：' + error.message + '。目录：' + temp);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  release(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
