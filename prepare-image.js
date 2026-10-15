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
const official=fs.readFileSync(path.join(source,'Dockerfile'),'utf8');
if(!official.includes('nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04')||!official.includes('COPY requirements.txt'))throw Error('Upstream Dockerfile changed');
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
fs.writeFileSync(path.join(stage,'Dockerfile'),'# syntax=docker/dockerfile:1.7\n'+official.trimEnd()+'\n\n'+extension+'\n','utf8');
fs.writeFileSync(path.join(stage,'.dockerignore'),'.git\n.env\n.env.*\n*.pem\n*.key\n*.p12\n*.pfx\n**/__pycache__\n**/*.pyc\noutputs\nckpts\ncache\nloras\nworkspaces\nnode_modules\n','utf8');
const result={source_commit:commit,tracked_files:paths.length,built_image:false,gpu_tested:false,weights_included:false,context_path:stage};
console.log(JSON.stringify(result));
