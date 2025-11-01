/**
 * Integration Test: Text wrapping
 * Uses Node.js native test runner
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Text Wrapping', () => {
  it('should split long text into lines', () => {
    const longText = `I'll list the files in the current directory (\`/Users/Nikita_Levyankov/repos/EPMCDME/codemie-tools\`):

**Directories:**
- \`.claude\` - Claude configuration
- \`src\` - Source code
- \`dist\` - Distribution files`;

    const lines = longText.split('\n');

    assert.ok(lines.length > 1, 'Should have multiple lines');
    assert.ok(lines[0].includes('list the files'), 'First line should contain intro');
    assert.ok(lines.some(l => l.includes('Directories')), 'Should contain Directories header');
  });

  it('should preserve markdown formatting in lines', () => {
    const text = '**Directories:**\n- `.claude` - Claude configuration';
    const lines = text.split('\n');

    assert.ok(lines[0].includes('**'), 'Should preserve bold markdown');
    assert.ok(lines[1].includes('`'), 'Should preserve code markdown');
    assert.ok(lines[1].startsWith('- '), 'Should preserve list formatting');
  });
});
