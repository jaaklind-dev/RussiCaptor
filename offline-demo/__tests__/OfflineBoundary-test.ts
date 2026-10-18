import { installOfflineNetworkBoundary } from '../src/networkBoundary';
describe('offline network boundary',()=>{
  test.each(['fetch','XMLHttpRequest','WebSocket','EventSource'])('%s is blocked without transport',name=>{const transport=jest.fn();const target:Record<string,Function>={[name]:transport};installOfflineNetworkBoundary(target);expect(()=>target[name]('sensitive URL')).toThrow('OFFLINE_DEMO_NETWORK_FORBIDDEN');expect(transport).not.toHaveBeenCalled();expect(Object.getOwnPropertyDescriptor(target,name)).toMatchObject({writable:false,configurable:false});});
  test('constructor-style transports cannot open a connection',()=>{const target={} as {WebSocket:new()=>object};installOfflineNetworkBoundary(target);expect(()=>new target.WebSocket()).toThrow('OFFLINE_DEMO_NETWORK_FORBIDDEN');});
  test('installation is idempotent',()=>{const target={};installOfflineNetworkBoundary(target);expect(()=>installOfflineNetworkBoundary(target)).not.toThrow();});
  test('unreplaceable foreign network hooks fail closed',()=>{const target={};Object.defineProperty(target,'fetch',{value:()=>null,configurable:false});expect(()=>installOfflineNetworkBoundary(target)).toThrow('OFFLINE_DEMO_NETWORK_BOUNDARY_UNAVAILABLE');});
});
