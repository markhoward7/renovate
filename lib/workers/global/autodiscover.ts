import is from '@sindresorhus/is';
import { minimatch } from 'minimatch';
import type { AllConfig } from '../../config/types';
import { logger } from '../../logger';
import { platform } from '../../modules/platform';
import { configRegexPredicate, isConfigRegex } from '../../util/regex';

// istanbul ignore next
function repoName(value: string | { repository: string }): string {
  return String(is.string(value) ? value : value.repository).toLowerCase();
}

export async function autodiscoverRepositories(
  config: AllConfig,
): Promise<AllConfig> {
  const { autodiscoverFilter, autodiscoverExclusions } = config;
  if (config.platform === 'local') {
    if (config.repositories?.length) {
      logger.debug(
        { repositories: config.repositories },
        'Found repositories when in local mode',
      );
      throw new Error(
        'Invalid configuration: repositories list not supported when platform=local',
      );
    }
    config.repositories = ['local'];
    return config;
  }
  if (!config.autodiscover) {
    if (!config.repositories?.length) {
      logger.warn(
        'No repositories found - did you want to run with flag --autodiscover?',
      );
    }
    return config;
  }
  // Autodiscover list of repositories
  let discovered = await platform.getRepos({
    topics: config.autodiscoverTopics,
    includeMirrors: config.includeMirrors,
    namespaces: config.autodiscoverNamespaces,
  });
  if (!discovered?.length) {
    // Soft fail (no error thrown) if no accessible repositories
    logger.debug('No repositories were autodiscovered');
    return config;
  }

  logger.debug(`Autodiscovered ${discovered.length} repositories`);

  if (autodiscoverFilter) {
    logger.debug({ autodiscoverFilter }, 'Applying autodiscoverFilter');
    const addFilters = prepareFilter(autodiscoverFilter);
    const removeFilters = prepareFilter(autodiscoverExclusions);
    discovered = applyFilters(discovered, addFilters, removeFilters);

    if (!discovered.length) {
      // Soft fail (no error thrown) if no accessible repositories match the filter
      logger.debug('None of the discovered repositories matched the filter');
      return config;
    }
    logger.debug(
      `Autodiscovered ${discovered.length} repositories after filter`,
    );
  }

  logger.info({ repositories: discovered }, `Autodiscovered repositories`);

  // istanbul ignore if
  if (config.repositories?.length) {
    logger.debug(
      'Checking autodiscovered repositories against configured repositories',
    );
    for (const configuredRepo of config.repositories) {
      const repository = repoName(configuredRepo);
      let found = false;
      for (let i = discovered.length - 1; i > -1; i -= 1) {
        if (repository === repoName(discovered[i])) {
          found = true;
          logger.debug({ repository }, 'Using configured repository settings');
          // TODO: fix typings
          discovered[i] = configuredRepo as never;
        }
      }
      if (!found) {
        logger.warn(
          { repository },
          'Configured repository is in not in autodiscover list',
        );
      }
    }
  }
  return { ...config, repositories: discovered };
}

function prepareFilter(filter: string | string[] | undefined): string[] {
  if (is.array(filter)) {
    return filter;
  }
  if (is.string(filter)) {
    return [filter];
  }
  return [];
}

export function applyFilters(
  repos: string[],
  addFilters: string[],
  removeFilters: string[],
): string[] {
  const matched = addFilters.flatMap((filter) => applyFilter(repos, filter));
  const removeMatched = removeFilters.flatMap((filter) =>
    applyFilter(matched, filter),
  );

  return [...matched.filter((matched) => !removeMatched.includes(matched))];
}

function applyFilter(repos: string[], filter: string): string[] {
  const matched = new Set<string>();
  let res: string[];
  if (isConfigRegex(filter)) {
    const autodiscoveryPred = configRegexPredicate(filter);
    if (!autodiscoveryPred) {
      throw new Error(`Failed to parse regex pattern "${filter}"`);
    }
    res = repos.filter(autodiscoveryPred);
  } else {
    res = repos.filter(minimatch.filter(filter, { dot: true, nocase: true }));
  }
  for (const repository of res) {
    matched.add(repository);
  }
  return [...matched];
}
