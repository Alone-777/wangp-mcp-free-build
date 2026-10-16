'use strict';
// Create a reproducible build context from the official WanGP source.
// This script NEVER rents resources, pushes images, or installs models.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const source = path.resolve(process.env.WAN_SOURCE_DIR || path.join(__dirname,'..','WanGP-preparacao'));
const stage = path.resolve(process.env.WAN_STAGE_DIR || path.join(__dirname,'build-context'));
const startScript=path.join(__dirname,'image-mcp-entrypoint.sh');
function git(...args) {
  return cp.execFileSync('git',['-C',source,...args],{encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true}).trim();
}
if(!fs.existsSync(path.join(source,'.git'))) throw Error('Official WanGP git checkout not found');
const origin=git('remote','get-url','origin');
if(!/^https:\/\/github\.com\/deepbeepmeep\/Wan2GP(\.git)?$/i.test(origin)) throw Error('Wrong origin: '+origin);
const commit=git('rev-parse','HEAD');
const expected='de302eec64b692dc83949d687cadf7d60bd74091';
if(commit!==expected)throw Error('WanGP commit differs from audited version');
if(git('status','--porcelain'))throw Error('WanGP working tree not clean');
const official=fs.readFileSync(path.join(source,'Dockerfile'),'utf8').replace(/\r\n/g,'\n');
if(!official.includes('nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04')||!official.includes('COPY requirements.txt'))throw Error('Upstream Dockerfile changed');
// Ubuntu 22.04 provides Python 3.10, but scikit-image>=0.26.0 requires >=3.11.
// Use Python 3.12 from Ubuntu 24.04 and a venv to avoid PEP 668 restrictions.
function replaceExactlyOnce(input, oldText, newText, label) {
  const parts=input.split(oldText);
  if(parts.length!==2)throw Error('Unexpected upstream Dockerfile structure: '+label);
  return parts.join(newText);
}
let compatible=replaceExactlyOnce(official,
  'FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04',
  'FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu24.04',
  'Ubuntu base');
compatible=replaceExactlyOnce(compatible,
  'python3 python3-pip git wget curl cmake ninja-build',
  'python3 python3-venv python3-pip git wget curl cmake ninja-build',
  'python3-venv installation');
compatible=replaceExactlyOnce(compatible,
  'WORKDIR /workspace',
  [
    'RUN python3 -c "import sys; assert sys.version_info >= (3, 11), sys.version"',
    'RUN python3 -m venv /opt/wangp-venv',
    'ENV PATH="/opt/wangp-venv/bin:${PATH}"',
    'RUN python --version && pip --version',
    '',
    'WORKDIR /workspace'
  ].join('\n'),
  'venv setup');
// Prevent pip from silently replacing CUDA 12.8 builds with CUDA 13 packages.
// If any upstream dependency truly conflicts, make the build fail explicitly.
compatible=replaceExactlyOnce(compatible,
  'COPY requirements.txt .',
  'COPY requirements.txt .\nCOPY torch-constraints.txt .',
  'constraints file COPY');
compatible=replaceExactlyOnce(compatible,
  'RUN pip install -r requirements.txt',
  [
    'RUN pip install -r requirements.txt -c torch-constraints.txt && \\',
    '    python -c "import torch; assert torch.__version__ == \'2.10.0+cu128\', torch.__version__; assert torch.version.cuda == \'12.8\', torch.version.cuda" && \\',
    '    pip check'
  ].join('\n'),
  'requirements installation');
// Ubuntu 24.04 reserves UID 1000 (usually for the default 'ubuntu' user).
// Let useradd choose the next free UID; never collide with the base image.
compatible=replaceExactlyOnce(compatible,
  'RUN useradd -u 1000 -ms /bin/bash user',
  'RUN id -u user >/dev/null 2>&1 || useradd -ms /bin/bash user',
  'dedicated non-root account');
// SageAttention compiles CUDA extensions; it is optional when using SDPA.
// Exclude the whole upstream SageAttention compilation rather than copying a
// potentially incompatible toolkit/compiler step into the paid GPU image.
const sageStart='# Install SageAttention from git (patch GPU detection)';
const sageEnd='RUN id -u user >/dev/null 2>&1 || useradd -ms /bin/bash user';
const sageBegin=compatible.indexOf(sageStart);
const sageStop=compatible.indexOf(sageEnd, sageBegin);
if(sageBegin<0 || sageStop<0 || compatible.indexOf(sageStart,sageBegin+1)!==-1) {
  throw Error('Unexpected upstream SageAttention installation block');
}
compatible=compatible.slice(0,sageBegin)
  + '# SageAttention omitted: WanGP MCP runs with --attention sdpa.\n\n'
  + compatible.slice(sageStop);
const paths=cp.execFileSync('git',['-C',source,'ls-files','-z'],{maxBuffer:20*1024*1024}).toString('utf8').split('\0').filter(Boolean);
if(paths.length<200)throw Error('WanGP missing files');
if(!stage.startsWith(path.resolve(__dirname)+path.sep) && !stage.startsWith(path.resolve(process.env.RUNNER_TEMP||'')+path.sep))throw Error('Refusing to write outside project or runner temp');
fs.rmSync(stage,{recursive:true,force:true});
fs.mkdirSync(stage,{recursive:true});
for(const file of paths){
  if(path.isAbsolute(file)||file.split('/').includes('..'))throw Error('Suspicious source path');
  const src=path.join(source,file);
  if(!fs.statSync(src).isFile())continue;
  const dest=path.join(stage,file);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(src,dest);
}
fs.copyFileSync(startScript,path.join(stage,'image-mcp-entrypoint.sh'));
// decord 0.6.0 advertises an unsupported Python 3.12 platform even though pip
// installs it. Only the optional Windows DLL handling references decord in the
// checked WanGP source; avoid breaking pip check on the Linux 3.12 T2V image.
const requirementFile=path.join(stage,'requirements.txt');
let requirements=fs.readFileSync(requirementFile,'utf8').replace(/\r\n/g,'\n');
requirements=replaceExactlyOnce(requirements,
  'decord; sys_platform != "darwin"',
  '# decord omitted in Linux/Python 3.12 image; optional video decoder (platform unsupported)',
  'optional decord requirement');
fs.writeFileSync(requirementFile,requirements,'utf8');
// Pin the entire PyTorch trio on the same CUDA 12.8 build for the full pip resolve.
fs.writeFileSync(path.join(stage,'torch-constraints.txt'),
  'torch==2.10.0+cu128\n'
  +'torchvision==0.25.0+cu128\n'
  +'torchaudio==2.10.0+cu128\n','utf8');
const extension=[
  'LABEL org.opencontainers.image.source="https://github.com/deepbeepmeep/Wan2GP"',
  'LABEL org.opencontainers.image.revision="'+commit+'"',
  'WORKDIR /workspace/WanGP',
  'COPY --chown=user:user . /workspace/WanGP/',
  'RUN mkdir -p /data/config /data/cache /data/outputs /data/workspaces && chown -R user:user /data /workspace/WanGP',
  'ENV HOME=/home/user',
  'ENV PYTHONUNBUFFERED=1',
  'ENV HF_HOME=/data/cache/huggingface',
  'ENV XDG_CACHE_HOME=/data/cache',
  'USER user',
  'VOLUME ["/data"]',
  'ENTRYPOINT ["/bin/bash","/workspace/WanGP/image-mcp-entrypoint.sh"]'
].join('\n');
fs.writeFileSync(path.join(stage,'Dockerfile'),'# syntax=docker/dockerfile:1.7\n'+compatible.trimEnd()+'\n\n'+extension+'\n','utf8');
fs.writeFileSync(path.join(stage,'.dockerignore'),'.git\n.env\n.env.*\n*.pem\n*.key\n*.p12\n*.pfx\n**/__pycache__\n**/*.pyc\noutputs\nckpts\ncache\nloras\nworkspaces\nnode_modules\n','utf8');
const result={source_commit:commit,tracked_files:paths.length,built_image:false,gpu_tested:false,weights_included:false,context_path:stage};
console.log(JSON.stringify(result));
