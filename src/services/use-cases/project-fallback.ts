export const withProjectTenantFallback = async <T>(input: {
  queryByProject: () => Promise<T>;
  queryByTenant: () => Promise<T>;
  shouldFallback: (result: T) => boolean;
}) => {
  const projectResult = await input.queryByProject();
  if (!input.shouldFallback(projectResult)) {
    return projectResult;
  }
  return input.queryByTenant();
};
