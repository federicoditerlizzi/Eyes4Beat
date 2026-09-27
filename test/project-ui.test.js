import test from 'node:test';
import assert from 'node:assert/strict';
import {projectActions,projectSyncStatus} from '../src/ui/project-ui.js';
const project={id:'p',archetypeOrder:['a'],ownerEmail:'me'};
test('project actions preserve owner-only sharing and deletion',()=>{
 assert.deepEqual(projectActions(project,'me'),['rename','duplicate','share','delete','export']);
 assert.deepEqual(projectActions(project,'other'),['rename','duplicate','export']);
 assert.deepEqual(projectActions({...project,ownerEmail:null},''),['rename','duplicate','export']);
});
test('sync dot isolates project changes, offline readiness and errors',()=>{
 const status=extra=>projectSyncStatus({project,ready:true,state:{status:'synced'},...extra}).kind;
 assert.equal(status({}),'synced');
 assert.equal(status({meta:{dirty:{'archetypes:other':{}}}}),'synced');
 assert.equal(status({meta:{dirty:{'archetypes:a':{}}}}),'pending');
 assert.equal(status({meta:{dirty:{'projects:p':{}}}}),'pending');
 assert.equal(status({meta:{dirty:{'lookPresets:x':{projectId:'p'}}}}),'pending');
 assert.equal(status({pendingIds:['a']}),'pending');
 assert.equal(status({failedIds:['a']}),'error');
 assert.equal(status({meta:{conflicts:{'archetypes:other':{}}}}),'synced');
 assert.equal(status({meta:{conflicts:{'archetypes:a':{}}}}),'error');
 assert.equal(status({meta:{deferred:[{store:'archetypes',value:{id:'a'}}]}}),'pending');
 assert.equal(status({state:{status:'offline'}}),'offline-ready');
 assert.equal(status({ready:false,state:{status:'offline'}}),'offline');
 assert.equal(status({state:{status:'session-expired'}}),'error');
});
