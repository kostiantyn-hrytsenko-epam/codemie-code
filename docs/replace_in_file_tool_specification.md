# Replace In File Tool - Complete Specification

> **Note**: This specification has been updated to include insert operations (`insert_before` and `insert_after` types) in addition to the original replacement functionality. The implementation now supports five operation types instead of three.

## Product Requirements Document (PRD)

### Overview
The `replace_in_file` tool is a token-efficient file modification utility designed for AI agents to perform multiple precise replacements in a single file operation. It eliminates the need for multiple read/write cycles, significantly reducing token usage and improving performance.

### Business Requirements

#### Primary Goals
1. **Token Efficiency**: Reduce token usage by 60-80% compared to traditional read_file/write_file approaches
2. **Precision**: Enable exact line-based replacements without ambiguity
3. **Batch Operations**: Support multiple replacements in a single tool call
4. **Reliability**: Prevent line number shifting issues that plague sequential replacement tools

#### Success Metrics
- Reduction in total tokens per file modification task
- Elimination of replacement positioning errors
- Support for complex multi-replacement operations
- Zero data loss during file modifications

### Functional Requirements

#### Core Features
1. **Multi-Replacement Support**: Process multiple replacements in a single operation
2. **Five Operation Types**:
   - `lines`: Position-based replacement using line numbers (PREFERRED)
   - `insert_before`: Insert text before specified line number
   - `insert_after`: Insert text after specified line number
   - `string`: Pattern-based replacement for identical text occurrences
   - `regex`: Pattern matching with regular expressions
3. **Atomic Operations**: All replacements succeed or none are applied
4. **Security Controls**: Path traversal prevention and working directory constraints
5. **Progress Reporting**: Real-time operation status for user feedback

#### Usage Patterns
- **Preferred**: Line-based replacements for precise, targeted modifications
- **Fallback**: String replacements for bulk find-and-replace operations
- **Advanced**: Regex replacements for pattern-based modifications

### Technical Architecture

## Technical Specification

### Tool Interface

#### Schema Definition
```typescript
interface ReplaceInFileSchema {
  filePath: string;                    // Relative path from working directory
  replacements: Array<{
    type: 'lines' | 'insert_before' | 'insert_after' | 'string' | 'regex';

    // Line-based replacement (PREFERRED)
    startLine?: number;               // 1-indexed, required for 'lines' type
    endLine?: number;                 // 1-indexed, required for 'lines' type

    // Insert operations (NEW)
    lineNumber?: number;              // 1-indexed, required for 'insert_before' and 'insert_after' types
    insertText?: string;              // Required for insert operations

    // Pattern-based replacement
    searchFor?: string;               // Required for 'string' and 'regex' types

    // Final content (for line replacements and pattern replacements)
    replaceWith?: string;             // Required for 'lines', 'string', and 'regex' types
  }>;
}
```

#### Parameter Guidelines
- **filePath**: Must be relative to working directory, security validated
- **type**:
  - `"lines"` - PREFERRED: Position-based, requires startLine/endLine/replaceWith
  - `"insert_before"` - Insert text before specified line, requires lineNumber/insertText
  - `"insert_after"` - Insert text after specified line, requires lineNumber/insertText
  - `"string"` - Pattern-based, requires searchFor/replaceWith (literal text)
  - `"regex"` - Pattern-based, requires searchFor/replaceWith (regex pattern)
- **startLine/endLine**: 1-indexed line numbers, inclusive range (for 'lines' type)
- **lineNumber**: 1-indexed line number (for insert operations)
- **insertText**: Text to insert (for insert operations)
- **searchFor**: NOT used for "lines" or insert types, required for string/regex
- **replaceWith**: Complete final content for lines/string/regex types

### Core Algorithm: Chunk-Based Processing

#### Problem Statement
Traditional replacement tools suffer from "line number shifting" - when early replacements change file structure, later replacements target wrong lines.

#### Solution: Boundary-Based Chunking
The tool uses a sophisticated chunk-based algorithm that processes file modifications without line number conflicts.

#### Algorithm Steps

1. **Validation Phase**
   ```typescript
   // Validate all replacements before processing
   for (const replacement of replacements) {
     if (replacement.type === 'lines') {
       if (!replacement.startLine || !replacement.endLine) {
         throw new Error('startLine and endLine required for lines type');
       }
       if (replacement.startLine < 1 || replacement.endLine < replacement.startLine) {
         throw new Error('Invalid line range');
       }
       if (!replacement.replaceWith) {
         throw new Error('replaceWith is required for lines type');
       }
     } else if (replacement.type === 'insert_before' || replacement.type === 'insert_after') {
       if (!replacement.lineNumber) {
         throw new Error('lineNumber is required for insert operations');
       }
       if (replacement.lineNumber < 1) {
         throw new Error('lineNumber must be positive');
       }
       if (!replacement.insertText) {
         throw new Error('insertText is required for insert operations');
       }
     } else if (replacement.type === 'string' || replacement.type === 'regex') {
       if (!replacement.searchFor) {
         throw new Error('searchFor is required for string/regex types');
       }
       if (!replacement.replaceWith) {
         throw new Error('replaceWith is required for string/regex types');
       }
     }
   }
   ```

2. **Overlap Detection**
   ```typescript
   // Sort line replacements and check for overlaps
   const lineReplacements = replacements
     .filter(r => r.type === 'lines')
     .sort((a, b) => a.startLine! - b.startLine!);

   for (let i = 1; i < lineReplacements.length; i++) {
     const prev = lineReplacements[i - 1];
     const curr = lineReplacements[i];
     if (curr.startLine! <= prev.endLine!) {
       throw new Error(`Overlapping replacements detected`);
     }
   }
   ```

3. **Operation Separation and Boundary Creation**
   ```typescript
   // Separate different operation types for processing
   const lineReplacements = replacements
     .filter(r => r.type === 'lines')
     .map(r => ({
       startLine: r.startLine!,
       endLine: r.endLine!,
       replaceWith: r.replaceWith!
     }));

   const insertOperations = replacements
     .filter(r => r.type === 'insert_before' || r.type === 'insert_after')
     .map(r => ({
       type: r.type as 'insert_before' | 'insert_after',
       lineNumber: r.lineNumber!,
       insertText: r.insertText!
     }));

   // Create boundary points for chunk processing
   const boundaries = new Set<number>();
   boundaries.add(1);                    // Start of file
   boundaries.add(lines.length + 1);     // End of file

   // Add boundaries for line replacements
   for (const replacement of lineReplacements) {
     boundaries.add(replacement.startLine);
     boundaries.add(replacement.endLine + 1);  // End boundary is after last line
   }

   // Add boundaries for insert operations
   for (const insert of insertOperations) {
     if (insert.type === 'insert_before') {
       boundaries.add(insert.lineNumber); // Insert before this line
     } else { // insert_after
       boundaries.add(insert.lineNumber + 1); // Insert after this line
     }
   }

   const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
   ```

4. **Chunk Processing**
   ```typescript
   interface FileChunk {
     startLine: number;
     endLine: number;
     content: string;
     shouldReplace: boolean;
     replacementContent?: string;
     insertBefore?: string;
     insertAfter?: string;
   }

   const chunks: FileChunk[] = [];

   for (let i = 0; i < sortedBoundaries.length - 1; i++) {
     const startLine = sortedBoundaries[i];
     const endLine = sortedBoundaries[i + 1] - 1;

     // Skip empty ranges
     if (startLine > lines.length || endLine < startLine) {
       continue;
     }

     // Extract original content for this chunk
     const chunkLines = lines.slice(startLine - 1, Math.min(endLine, lines.length));
     const content = chunkLines.join('\n');

     // Check if this chunk should be replaced
     const replacement = lineReplacements.find(r =>
       r.startLine === startLine && r.endLine === endLine
     );

     // Check for insert operations at this position
     const insertBefore = insertOperations.find(r =>
       r.type === 'insert_before' && r.lineNumber === startLine
     );
     // For insert_after, we want to insert after the last line of this chunk
     const insertAfter = insertOperations.find(r =>
       r.type === 'insert_after' && r.lineNumber === Math.min(endLine, lines.length)
     );

     chunks.push({
       startLine,
       endLine: Math.min(endLine, lines.length),
       content,
       shouldReplace: !!replacement,
       replacementContent: replacement?.replaceWith,
       insertBefore: insertBefore?.insertText,
       insertAfter: insertAfter?.insertText
     });
   }
   ```

5. **Content Reconstruction**
   ```typescript
   const finalParts: string[] = [];

   for (let i = 0; i < chunks.length; i++) {
     const chunk = chunks[i];

     // Add insert_before content
     if (chunk.insertBefore) {
       finalParts.push(chunk.insertBefore);
     }

     // Add main content (original or replacement)
     if (chunk.shouldReplace) {
       finalParts.push(chunk.replacementContent!);
     } else {
       finalParts.push(chunk.content);
     }

     // Add insert_after content
     if (chunk.insertAfter) {
       finalParts.push(chunk.insertAfter);
     }

     // Add newline separator between chunks (except after the last chunk)
     if (i < chunks.length - 1 && chunk.content.length > 0) {
       const nextChunk = chunks[i + 1];
       if (nextChunk.content.length > 0 || nextChunk.shouldReplace) {
         finalParts.push('\n');
       }
     }
   }

   const finalContent = finalParts.join('');
   ```

### String and Regex Processing

#### String Replacement
```typescript
// Process after line-based replacements
for (const replacement of stringReplacements) {
  const searchPattern = new RegExp(escapeRegex(replacement.searchFor!), 'g');
  const matches = (content.match(searchPattern) || []).length;

  if (matches > 0) {
    content = content.replace(searchPattern, replacement.replaceWith);
    totalReplacements += matches;
  }
}
```

#### Regex Replacement
```typescript
// Direct regex processing
for (const replacement of regexReplacements) {
  const searchPattern = new RegExp(replacement.searchFor!, 'g');
  const matches = (content.match(searchPattern) || []).length;

  if (matches > 0) {
    content = content.replace(searchPattern, replacement.replaceWith);
    totalReplacements += matches;
  }
}
```

### Security Implementation

#### Path Security
```typescript
// Resolve and validate file path
const resolvedPath = path.resolve(workingDirectory, filePath);

// Prevent path traversal attacks
if (!resolvedPath.startsWith(workingDirectory)) {
  throw new Error('Access denied: Path is outside working directory');
}
```

#### Input Validation
```typescript
// Validate replacement parameters
if (replacement.type === 'lines') {
  if (replacement.startLine === undefined || replacement.endLine === undefined) {
    throw new Error('startLine and endLine are required for "lines" type');
  }
  if (replacement.startLine < 1 || replacement.endLine < replacement.startLine) {
    throw new Error('Invalid line range');
  }
  if (!replacement.replaceWith) {
    throw new Error('replaceWith is required for "lines" type');
  }
} else if (replacement.type === 'insert_before' || replacement.type === 'insert_after') {
  if (replacement.lineNumber === undefined) {
    throw new Error('lineNumber is required for insert operations');
  }
  if (replacement.lineNumber < 1) {
    throw new Error('lineNumber must be positive');
  }
  if (!replacement.insertText) {
    throw new Error('insertText is required for insert operations');
  }
} else if (replacement.type === 'string' || replacement.type === 'regex') {
  if (!replacement.searchFor) {
    throw new Error('searchFor is required for "string" and "regex" types');
  }
  if (!replacement.replaceWith) {
    throw new Error('replaceWith is required for "string" and "regex" types');
  }
}
```

### Progress Reporting System

#### Progress Events
```typescript
interface ToolProgress {
  percentage: number;           // 0-100
  operation: string;           // Human-readable operation description
  details?: string;            // Additional context
  estimatedTimeRemaining?: number; // Milliseconds (optional)
}

// Example progress flow
emitToolProgress('replace_in_file', {
  percentage: 10,
  operation: `Processing ${replacements.length} replacement(s)...`,
  details: `Reading file: ${filePath}`
});

// ... processing ...

emitToolProgress('replace_in_file', {
  percentage: 100,
  operation: `Replacements completed`,
  details: `Applied ${totalReplacements} change(s)`
});
```

### Debug Logging

#### Comprehensive Logging
```typescript
// Log tool invocation
logger.info('🔧 REPLACE_IN_FILE DEBUG - Tool Call Started');
logger.info('📄 File Path:', filePath);
logger.info('📊 Number of replacements:', replacements.length);

// Log each replacement in detail
replacements.forEach((replacement, index) => {
  logger.info(`${index + 1}. Type: ${replacement.type}`);
  if (replacement.type === 'lines') {
    logger.info(`   Lines: ${replacement.startLine}-${replacement.endLine}`);
    logger.info(`   Replace with: "${replacement.replaceWith}"`);
  } else {
    logger.info(`   Search for: "${replacement.searchFor}"`);
    logger.info(`   Replace with: "${replacement.replaceWith}"`);
  }
});

// Log processing results
logger.info('✅ File successfully modified');
logger.info('📊 Total replacement operations:', replacements.length);
logger.info('🔄 Total individual changes:', totalReplacements);
```

### Error Handling

#### Error Categories
1. **Validation Errors**: Invalid parameters or ranges
2. **File System Errors**: File not found, permission issues
3. **Security Errors**: Path traversal attempts
4. **Processing Errors**: Overlapping replacements, malformed patterns

#### Error Response Format
```typescript
// Structured error responses
try {
  // ... processing logic
} catch (error) {
  return `Error performing replacements: ${error instanceof Error ? error.message : String(error)}`;
}
```

### Usage Examples

#### Example 1: Single Line Replacement
```json
{
  "filePath": "src/config.ts",
  "replacements": [
    {
      "type": "lines",
      "startLine": 5,
      "endLine": 5,
      "replaceWith": "const API_URL = 'https://api.example.com/v2';"
    }
  ]
}
```

#### Example 2: Multi-Line Function Replacement
```json
{
  "filePath": "src/utils.ts",
  "replacements": [
    {
      "type": "lines",
      "startLine": 10,
      "endLine": 15,
      "replaceWith": "function calculateTotal(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}"
    }
  ]
}
```

#### Example 3: Multiple Replacements
```json
{
  "filePath": "src/app.ts",
  "replacements": [
    {
      "type": "lines",
      "startLine": 1,
      "endLine": 1,
      "replaceWith": "import { newModule } from './new-module';"
    },
    {
      "type": "string",
      "searchFor": "oldFunctionName",
      "replaceWith": "newFunctionName"
    },
    {
      "type": "lines",
      "startLine": 50,
      "endLine": 52,
      "replaceWith": "// Updated implementation\nconst result = newModule.process(data);\nreturn result;"
    }
  ]
}
```

#### Example 4: Insert Operations
```json
{
  "filePath": "src/config.ts",
  "replacements": [
    {
      "type": "insert_before",
      "lineNumber": 1,
      "insertText": "// Configuration file for the application"
    },
    {
      "type": "insert_after",
      "lineNumber": 10,
      "insertText": "export const NEW_FEATURE_FLAG = true;"
    }
  ]
}
```

#### Example 5: Combined Operations (Line Replacement + Inserts)
```json
{
  "filePath": "src/service.ts",
  "replacements": [
    {
      "type": "insert_before",
      "lineNumber": 1,
      "insertText": "// Updated service implementation"
    },
    {
      "type": "lines",
      "startLine": 15,
      "endLine": 20,
      "replaceWith": "// Refactored method\nprocessData(data: DataType[]): ProcessedData {\n  return data.map(item => this.transform(item));\n}"
    },
    {
      "type": "insert_after",
      "lineNumber": 50,
      "insertText": "// End of service class"
    }
  ]
}
```

#### Example 6: Insert at End of File
```json
{
  "filePath": "src/utils.ts",
  "replacements": [
    {
      "type": "insert_after",
      "lineNumber": 25,
      "insertText": "\n// Additional utility functions can be added here"
    }
  ]
}
```

### Implementation Guidelines for LLMs

#### Best Practices
1. **Prefer Line-Based Operations**: Always use `type: "lines"` when you know specific line numbers for replacements
2. **Use Insert Operations for Additions**: Use `insert_before` or `insert_after` for adding new content without replacing existing lines
3. **Provide Complete Content**: For line replacements, specify the entire final content that should exist at those lines
4. **Don't Include Existing Text**: Only specify what needs to change, not what should remain
5. **Use Minimal Ranges**: Replace only the lines that actually need modification
6. **Batch Operations**: Include all related replacements and inserts in a single tool call
7. **Insert at File Boundaries**: Use `insert_before` line 1 for beginning of file, `insert_after` last line for end of file

#### Common Mistakes to Avoid
1. **Including Search Content in Line/Insert Operations**: Don't specify `searchFor` for `type: "lines"`, `insert_before`, or `insert_after`
2. **Overlapping Line Ranges**: Ensure line replacements don't overlap with each other
3. **Including Unchanged Content**: Don't include existing text that doesn't need modification
4. **Multiple Tool Calls**: Use single call with multiple replacements and inserts instead of separate calls
5. **Wrong Parameters for Insert Operations**: Don't use `startLine`/`endLine`/`replaceWith` for insert operations
6. **Missing Required Parameters**: Ensure `lineNumber` and `insertText` for inserts, `startLine`/`endLine`/`replaceWith` for lines

#### Troubleshooting
- **No Changes Made**: Check that line numbers exist and content is different for replacements
- **Overlapping Replacements**: Ensure line ranges don't conflict with each other
- **Invalid Line Range**: Verify startLine ≤ endLine and both are positive for line replacements
- **Invalid Line Number**: Verify lineNumber is positive and within file bounds for insert operations
- **Missing Insert Text**: Ensure insertText is provided for insert operations
- **Path Errors**: Ensure file path is relative to working directory
- **Insert After End of File**: Use `insert_after` with the last line number of the file
- **Mixed Operation Types**: Don't mix parameters (e.g., don't use `replaceWith` with insert operations)

### Performance Characteristics

#### Time Complexity
- File reading: O(n) where n = file size
- Chunk processing: O(r log r) where r = number of replacements
- Content reconstruction: O(n + r)
- Overall: O(n + r log r)

#### Memory Usage
- Stores entire file content in memory during processing
- Additional memory for chunk metadata: O(r)
- Peak memory usage: ~2x file size during processing

#### Token Efficiency
- Traditional approach: Read file + N write operations = (file_size + N * file_size) tokens
- This tool: Single operation = (file_size + replacement_content) tokens
- Typical reduction: 60-80% fewer tokens for multi-replacement operations

## Recent Updates

### Version 1.1 (December 2025)
- **Fixed insert_after operation logic**: Resolved issue where `insert_after` operations at the end of files or in combined operations were not working correctly
- **Enhanced chunk matching**: Improved the algorithm to properly match `insert_after` operations to the correct file chunks
- **Added comprehensive insert operation support**: Full support for `insert_before` and `insert_after` operations with proper boundary handling
- **TypeScript type safety**: Fixed compilation issues and improved type safety for operation filtering

### Key Bug Fix Details
The critical fix involved correcting the chunk matching logic for `insert_after` operations:

```typescript
// OLD (incorrect) - was checking startLine - 1
const insertAfter = validInserts.find(r =>
  r.type === 'insert_after' && r.lineNumber === startLine - 1
);

// NEW (correct) - checks the last line of the chunk
const insertAfter = validInserts.find(r =>
  r.type === 'insert_after' && r.lineNumber === Math.min(endLine, lines.length)
);
```

This fix ensures that:
- Insert operations at the end of files work correctly
- Combined operations (line replacements + inserts) execute properly
- All test scenarios pass consistently

---

This specification provides complete implementation guidance for recreating the replace_in_file tool with identical functionality, security, and performance characteristics.