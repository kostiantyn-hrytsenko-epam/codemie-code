/**
 * Test helpers and utilities
 * Provides common functionality for test files
 */

/**
 * Check if base URL is configured for tests to run
 * Tests that require LLM interaction need a valid base URL
 *
 * @returns {boolean} true if base URL is configured, false otherwise
 */
export function isBaseUrlConfigured() {
  return !!(
    process.env.CODEMIE_BASE_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    process.env.OPENAI_BASE_URL
  );
}

/**
 * Check if we should skip tests that require base URL
 * Prints a warning message if base URL is not configured
 *
 * This function returns true if tests should be skipped. Tests should check
 * the return value and return early if true.
 *
 * @param {string} [customMessage] - Optional custom message to display
 * @returns {boolean} true if test should be skipped, false otherwise
 */
export function skipIfNoBaseUrl(customMessage) {
  if (!isBaseUrlConfigured()) {
    const message = customMessage ||
      'Base URL not configured. Set CODEMIE_BASE_URL, ANTHROPIC_BASE_URL, or OPENAI_BASE_URL environment variable.';

    console.warn(`⚠️  Skipping test: ${message}`);
    return true;
  }
  return false;
}

/**
 * Get list of required environment variables that are missing
 *
 * @returns {string[]} Array of missing environment variable names
 */
export function getMissingEnvVars() {
  const missing = [];

  // Check base URL
  if (!isBaseUrlConfigured()) {
    missing.push('BASE_URL (CODEMIE_BASE_URL, ANTHROPIC_BASE_URL, or OPENAI_BASE_URL)');
  }

  // Check auth token
  const hasAuthToken = !!(
    process.env.CODEMIE_AUTH_TOKEN ||
    process.env.CODEMIE_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_AUTH_TOKEN ||
    process.env.OPENAI_API_KEY
  );

  if (!hasAuthToken) {
    missing.push('AUTH_TOKEN (CODEMIE_AUTH_TOKEN, ANTHROPIC_AUTH_TOKEN, or OPENAI_AUTH_TOKEN)');
  }

  return missing;
}

/**
 * Check if all required environment variables are configured
 *
 * @returns {boolean} true if all required env vars are set
 */
export function isFullyConfigured() {
  return getMissingEnvVars().length === 0;
}

/**
 * Print configuration status for debugging
 */
export function printConfigStatus() {
  console.log('\n=== Test Configuration Status ===');
  console.log('Base URL configured:', isBaseUrlConfigured());
  console.log('Fully configured:', isFullyConfigured());

  const missing = getMissingEnvVars();
  if (missing.length > 0) {
    console.log('\nMissing configuration:');
    missing.forEach(env => console.log(`  - ${env}`));
  }
  console.log('=================================\n');
}
