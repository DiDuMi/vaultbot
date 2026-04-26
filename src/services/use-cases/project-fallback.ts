export const withProjectFallback = async <T>(input: {
  queryByProject: () => Promise<T>;
  queryByFallback: () => Promise<T>;
  shouldFallback: (result: T) => boolean;
}) => {
  const projectResult = await input.queryByProject();
  if (!input.shouldFallback(projectResult)) {
    return projectResult;
  }
  return input.queryByFallback();
};

export const withProjectTenantFallback = async <T>(input: {
  queryByProject: () => Promise<T>;
  queryByTenant: () => Promise<T>;
  shouldFallback: (result: T) => boolean;
}) =>
  withProjectFallback({
    queryByProject: input.queryByProject,
    queryByFallback: input.queryByTenant,
    shouldFallback: input.shouldFallback
  });
