import { config } from '../config';

async function tenantPrecheck() {
  console.log('=== 租户预检 ===');
  console.log(`TENANT_CODE: ${config.tenantCode}`);
  console.log(`EXPECTED_TENANT_CODE: ${config.expectedTenantCode || '未设置'}`);
  console.log(`OPS_TOKEN: ${config.opsToken ? '已设置' : '未设置'}`);
  
  if (config.expectedTenantCode && config.tenantCode !== config.expectedTenantCode) {
    console.error(`❌ 租户代码不匹配！期望: ${config.expectedTenantCode}, 实际: ${config.tenantCode}`);
    process.exit(1);
  }
  
  if (!config.opsToken) {
    console.warn('⚠️  OPS_TOKEN 未设置，运维接口将无法使用');
  }
  
  console.log('✅ 租户预检通过');
}

tenantPrecheck().catch(console.error);

