#!/usr/bin/env node
// Reverse Compiler: OpenFisca Python → Courgette DSL
//
// Parses OpenFisca Python code from NZ/France country packages
// and generates readable Courgette plain English rules.

// =============================================================================
// PYTHON TOKENIZER (subset for OpenFisca patterns)
// =============================================================================

const PyTokenType = {
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  OPERATOR: 'OPERATOR',
  KEYWORD: 'KEYWORD',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  COMMA: 'COMMA',
  COLON: 'COLON',
  DOT: 'DOT',
  NEWLINE: 'NEWLINE',
  INDENT: 'INDENT',
  DEDENT: 'DEDENT',
  DECORATOR: 'DECORATOR',
  EOF: 'EOF'
};

const PYTHON_KEYWORDS = [
  'class', 'def', 'return', 'if', 'elif', 'else', 'and', 'or', 'not',
  'True', 'False', 'None', 'import', 'from', 'as', 'in', 'is', 'for', 'while'
];

const PYTHON_OPERATORS = [
  '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '//', '%',
  '=', '+=', '-=', '*=', '&', '|', '~'
];

function tokenizePython(source) {
  const tokens = [];
  const lines = source.split('\n');
  let indentStack = [0];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    // Handle indentation
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent > indentStack[indentStack.length - 1]) {
      indentStack.push(indent);
      tokens.push({ type: PyTokenType.INDENT, value: indent, line: lineNum });
    } else {
      while (indent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
        tokens.push({ type: PyTokenType.DEDENT, value: indent, line: lineNum });
      }
    }

    // Tokenize line content
    let pos = indent;
    while (pos < line.length) {
      // Skip whitespace
      if (/\s/.test(line[pos])) {
        pos++;
        continue;
      }

      // Skip inline comments
      if (line[pos] === '#') {
        break;
      }

      // Decorator
      if (line[pos] === '@') {
        let start = pos;
        pos++;
        while (pos < line.length && /[a-zA-Z0-9_]/.test(line[pos])) {
          pos++;
        }
        tokens.push({ type: PyTokenType.DECORATOR, value: line.substring(start, pos), line: lineNum });
        continue;
      }

      // String literals
      if (line[pos] === '"' || line[pos] === "'") {
        const quote = line[pos];
        const isTriple = line.substring(pos, pos + 3) === quote.repeat(3);
        pos += isTriple ? 3 : 1;
        let start = pos;

        if (isTriple) {
          // Multi-line string - find closing triple
          let content = '';
          while (lineNum < lines.length) {
            const endPos = lines[lineNum].indexOf(quote.repeat(3), pos);
            if (endPos !== -1) {
              content += lines[lineNum].substring(pos, endPos);
              pos = endPos + 3;
              break;
            }
            content += lines[lineNum].substring(pos) + '\n';
            lineNum++;
            pos = 0;
          }
          tokens.push({ type: PyTokenType.STRING, value: content, line: lineNum });
        } else {
          while (pos < line.length && line[pos] !== quote) {
            if (line[pos] === '\\') pos++;
            pos++;
          }
          tokens.push({ type: PyTokenType.STRING, value: line.substring(start, pos), line: lineNum });
          pos++;
        }
        continue;
      }

      // Numbers
      if (/\d/.test(line[pos])) {
        let start = pos;
        while (pos < line.length && /[\d._]/.test(line[pos])) {
          pos++;
        }
        tokens.push({ type: PyTokenType.NUMBER, value: parseFloat(line.substring(start, pos).replace(/_/g, '')), line: lineNum });
        continue;
      }

      // Operators
      let matchedOp = null;
      for (const op of PYTHON_OPERATORS) {
        if (line.substring(pos, pos + op.length) === op) {
          if (!matchedOp || op.length > matchedOp.length) {
            matchedOp = op;
          }
        }
      }
      if (matchedOp) {
        tokens.push({ type: PyTokenType.OPERATOR, value: matchedOp, line: lineNum });
        pos += matchedOp.length;
        continue;
      }

      // Punctuation
      const punct = { '(': PyTokenType.LPAREN, ')': PyTokenType.RPAREN,
                      '[': PyTokenType.LBRACKET, ']': PyTokenType.RBRACKET,
                      ',': PyTokenType.COMMA, ':': PyTokenType.COLON, '.': PyTokenType.DOT };
      if (punct[line[pos]]) {
        tokens.push({ type: punct[line[pos]], value: line[pos], line: lineNum });
        pos++;
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(line[pos])) {
        let start = pos;
        while (pos < line.length && /[a-zA-Z0-9_]/.test(line[pos])) {
          pos++;
        }
        const ident = line.substring(start, pos);
        if (PYTHON_KEYWORDS.includes(ident)) {
          tokens.push({ type: PyTokenType.KEYWORD, value: ident, line: lineNum });
        } else {
          tokens.push({ type: PyTokenType.IDENTIFIER, value: ident, line: lineNum });
        }
        continue;
      }

      // Skip unknown characters
      pos++;
    }

    tokens.push({ type: PyTokenType.NEWLINE, value: '\n', line: lineNum });
  }

  // Close any remaining indentation
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: PyTokenType.DEDENT, value: 0, line: lines.length });
  }

  tokens.push({ type: PyTokenType.EOF, value: null, line: lines.length });
  return tokens;
}

// =============================================================================
// OPENFISCA PARSER
// =============================================================================

function parseOpenFisca(tokens) {
  let pos = 0;
  const variables = [];

  function current() {
    return tokens[pos] || { type: PyTokenType.EOF };
  }

  function advance() {
    return tokens[pos++];
  }

  function expect(type) {
    const tok = current();
    if (tok.type !== type) {
      throw new Error(`Expected ${type}, got ${tok.type} at line ${tok.line}`);
    }
    return advance();
  }

  function skipUntil(...types) {
    while (!types.includes(current().type) && current().type !== PyTokenType.EOF) {
      advance();
    }
  }

  function parseClassBody() {
    const attributes = {};
    const formulas = [];

    while (current().type !== PyTokenType.DEDENT && current().type !== PyTokenType.EOF) {
      if (current().type === PyTokenType.NEWLINE || current().type === PyTokenType.INDENT) {
        advance();
        continue;
      }

      // Parse attribute assignment: value_type = float
      if (current().type === PyTokenType.IDENTIFIER) {
        const attrName = advance().value;

        if (current().type === PyTokenType.OPERATOR && current().value === '=') {
          advance(); // skip =

          // Collect value until newline
          let value = '';
          while (current().type !== PyTokenType.NEWLINE && current().type !== PyTokenType.EOF) {
            value += current().value;
            advance();
          }
          attributes[attrName] = value.trim();
        }
      }

      // Parse def formula(...)
      if (current().type === PyTokenType.KEYWORD && current().value === 'def') {
        advance(); // skip def
        const funcName = current().type === PyTokenType.IDENTIFIER ? advance().value : '';

        // Skip to colon
        skipUntil(PyTokenType.COLON);
        advance(); // skip :

        // Parse function body
        const bodyTokens = [];
        let depth = 0;

        // Wait for INDENT
        while (current().type !== PyTokenType.INDENT && current().type !== PyTokenType.EOF) {
          advance();
        }
        if (current().type === PyTokenType.INDENT) {
          advance();
          depth = 1;
        }

        while (depth > 0 && current().type !== PyTokenType.EOF) {
          if (current().type === PyTokenType.INDENT) depth++;
          if (current().type === PyTokenType.DEDENT) depth--;
          if (depth > 0) bodyTokens.push(advance());
          else advance();
        }

        formulas.push({
          name: funcName,
          tokens: bodyTokens
        });
        continue; // Don't advance again after parsing a function
      }

      if (current().type !== PyTokenType.EOF) {
        advance();
      }
    }

    if (current().type === PyTokenType.DEDENT) {
      advance();
    }

    return { attributes, formulas };
  }

  // Main parsing loop
  while (current().type !== PyTokenType.EOF) {
    // Look for class definitions
    if (current().type === PyTokenType.KEYWORD && current().value === 'class') {
      advance(); // skip 'class'

      const className = current().type === PyTokenType.IDENTIFIER ? advance().value : '';

      // Check if it extends Variable
      let extendsVariable = false;
      if (current().type === PyTokenType.LPAREN) {
        advance();
        if (current().type === PyTokenType.IDENTIFIER && current().value === 'Variable') {
          extendsVariable = true;
        }
        skipUntil(PyTokenType.RPAREN);
        advance(); // skip )
      }

      if (extendsVariable) {
        // Skip to colon and body
        skipUntil(PyTokenType.COLON);
        advance(); // skip :

        // Skip newlines/indents to get to body
        while (current().type === PyTokenType.NEWLINE) {
          advance();
        }
        if (current().type === PyTokenType.INDENT) {
          advance();
        }

        const body = parseClassBody();
        variables.push({
          name: className,
          ...body
        });
      }
    } else {
      advance();
    }
  }

  return { variables };
}

// =============================================================================
// PATTERN RECOGNITION
// =============================================================================

// Recognize NZ-style multiplication patterns (AND)
// e.g., resident * citizen * (has_children + adopted)
function recognizeMultiplicationPattern(tokens) {
  // First check if there's actually a * operator in the tokens
  const hasMultiplication = tokens.some(t =>
    t.type === PyTokenType.OPERATOR && t.value === '*'
  );
  if (!hasMultiplication) {
    return null;
  }

  const factors = [];
  let i = 0;
  let expectingFactor = true;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (expectingFactor) {
      if (tok.type === PyTokenType.IDENTIFIER) {
        factors.push({ type: 'variable', name: tok.value });
        expectingFactor = false;
      } else if (tok.type === PyTokenType.LPAREN) {
        // Find matching paren
        let depth = 1;
        let start = i + 1;
        i++;
        while (i < tokens.length && depth > 0) {
          if (tokens[i].type === PyTokenType.LPAREN) depth++;
          if (tokens[i].type === PyTokenType.RPAREN) depth--;
          i++;
        }
        const subTokens = tokens.slice(start, i - 1);
        const subPattern = recognizeAdditionPattern(subTokens);
        if (subPattern) {
          factors.push({ type: 'group', pattern: subPattern });
        }
        expectingFactor = false;
        continue;
      }
    } else {
      if (tok.type === PyTokenType.OPERATOR && tok.value === '*') {
        expectingFactor = true;
      }
    }
    i++;
  }

  if (factors.length > 1) {
    return { type: 'and', factors };
  }
  return null;
}

// Recognize NZ-style addition patterns (OR)
// e.g., has_children + adopted
function recognizeAdditionPattern(tokens) {
  const terms = [];
  let currentTerm = [];

  for (const tok of tokens) {
    if (tok.type === PyTokenType.OPERATOR && tok.value === '+') {
      if (currentTerm.length > 0) {
        terms.push(currentTerm);
        currentTerm = [];
      }
    } else if (tok.type !== PyTokenType.NEWLINE) {
      currentTerm.push(tok);
    }
  }
  if (currentTerm.length > 0) {
    terms.push(currentTerm);
  }

  if (terms.length > 1) {
    return {
      type: 'or',
      terms: terms.map(t => {
        if (t.length === 1 && t[0].type === PyTokenType.IDENTIFIER) {
          return { type: 'variable', name: t[0].value };
        }
        return { type: 'expression', tokens: t };
      })
    };
  }
  return null;
}

// Recognize France-style logical functions
// e.g., and_(condition_a, condition_b)
function recognizeLogicalFunction(tokens) {
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === PyTokenType.IDENTIFIER &&
        (tok.value === 'and_' || tok.value === 'or_' || tok.value === 'not_')) {
      const funcName = tok.value;
      i++;

      if (tokens[i]?.type === PyTokenType.LPAREN) {
        i++;
        const args = [];
        let currentArg = [];
        let depth = 1;

        while (i < tokens.length && depth > 0) {
          if (tokens[i].type === PyTokenType.LPAREN) depth++;
          if (tokens[i].type === PyTokenType.RPAREN) depth--;
          if (tokens[i].type === PyTokenType.COMMA && depth === 1) {
            args.push(currentArg);
            currentArg = [];
          } else if (depth > 0) {
            currentArg.push(tokens[i]);
          }
          i++;
        }
        if (currentArg.length > 0) {
          args.push(currentArg);
        }

        return {
          type: funcName.replace('_', ''),
          args: args.map(a => {
            if (a.length === 1 && a[0].type === PyTokenType.IDENTIFIER) {
              return { type: 'variable', name: a[0].value };
            }
            return { type: 'expression', tokens: a };
          })
        };
      }
    }
    i++;
  }
  return null;
}

// Recognize comparison expressions
// e.g., age >= 65
function recognizeComparison(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === PyTokenType.OPERATOR &&
        ['==', '!=', '<', '>', '<=', '>='].includes(tok.value)) {

      // Get left side
      const left = [];
      for (let j = i - 1; j >= 0; j--) {
        if (tokens[j].type === PyTokenType.IDENTIFIER || tokens[j].type === PyTokenType.NUMBER) {
          left.unshift(tokens[j]);
        } else break;
      }

      // Get right side
      const right = [];
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === PyTokenType.IDENTIFIER ||
            tokens[j].type === PyTokenType.NUMBER ||
            tokens[j].type === PyTokenType.STRING) {
          right.push(tokens[j]);
        } else break;
      }

      if (left.length > 0 && right.length > 0) {
        return {
          type: 'comparison',
          operator: tok.value,
          left: left.map(t => t.value).join('.'),
          right: right.map(t => t.value).join('.')
        };
      }
    }
  }
  return null;
}

// Recognize native Python boolean expressions
// e.g., age >= 18 and is_resident
// e.g., condition_a or condition_b
function recognizePythonBoolean(tokens) {
  // Check if there are any 'and' or 'or' keywords
  const hasBoolean = tokens.some(t =>
    t.type === PyTokenType.KEYWORD && (t.value === 'and' || t.value === 'or')
  );
  if (!hasBoolean) {
    return null;
  }

  // Split tokens by 'and' and 'or' keywords, tracking the operator
  const parts = [];
  let currentPart = [];
  let lastOperator = null;

  for (const tok of tokens) {
    if (tok.type === PyTokenType.KEYWORD && (tok.value === 'and' || tok.value === 'or')) {
      if (currentPart.length > 0) {
        parts.push({ tokens: currentPart, joinedBy: lastOperator });
        currentPart = [];
      }
      lastOperator = tok.value;
    } else if (tok.type !== PyTokenType.NEWLINE) {
      currentPart.push(tok);
    }
  }
  if (currentPart.length > 0) {
    parts.push({ tokens: currentPart, joinedBy: lastOperator });
  }

  if (parts.length < 2) {
    return null;
  }

  // Determine overall structure - if all operators are the same, use that
  // Otherwise, we'll treat it as a sequence
  const operators = parts.slice(1).map(p => p.joinedBy);
  const allAnd = operators.every(op => op === 'and');
  const allOr = operators.every(op => op === 'or');

  // Parse each part as either a comparison or a simple variable
  const parsedParts = parts.map(part => {
    const comp = recognizeComparison(part.tokens);
    if (comp) {
      return { ...comp, joinedBy: part.joinedBy };
    }
    // Try to extract a simple variable
    const identifiers = part.tokens.filter(t => t.type === PyTokenType.IDENTIFIER);
    if (identifiers.length === 1) {
      return { type: 'variable', name: identifiers[0].value, joinedBy: part.joinedBy };
    }
    // Check for 'not variable' pattern
    const notIdx = part.tokens.findIndex(t => t.type === PyTokenType.KEYWORD && t.value === 'not');
    if (notIdx !== -1 && part.tokens[notIdx + 1]?.type === PyTokenType.IDENTIFIER) {
      return { type: 'not_variable', name: part.tokens[notIdx + 1].value, joinedBy: part.joinedBy };
    }
    return { type: 'unknown', tokens: part.tokens, joinedBy: part.joinedBy };
  });

  if (allAnd) {
    return { type: 'and', args: parsedParts };
  } else if (allOr) {
    return { type: 'or', args: parsedParts };
  } else {
    // Mixed operators - return as a sequence preserving order
    return { type: 'sequence', parts: parsedParts };
  }
}

// Main pattern recognition for a formula
// Returns patterns in priority order - only the first matching pattern type is used
function recognizePatterns(formula) {
  const patterns = [];
  const tokens = formula.tokens;

  // Look for return statement
  let returnIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === PyTokenType.KEYWORD && tokens[i].value === 'return') {
      returnIdx = i;
      break;
    }
  }

  if (returnIdx >= 0) {
    const returnTokens = tokens.slice(returnIdx + 1);

    // Try pattern recognizers in priority order
    // Once a pattern matches, use only that one to avoid duplicates

    // 1. Multiplication pattern (NZ style: var * var * ...)
    const multPattern = recognizeMultiplicationPattern(returnTokens);
    if (multPattern) {
      patterns.push(multPattern);
    }

    // 2. Logical function pattern (France style: and_(), or_(), not_())
    // Only add if we didn't already find a multiplication pattern
    if (patterns.length === 0) {
      const logicalPattern = recognizeLogicalFunction(returnTokens);
      if (logicalPattern) {
        patterns.push(logicalPattern);
      }
    }

    // 3. Native Python boolean expressions (age >= 18 and is_resident)
    if (patterns.length === 0) {
      const pythonBoolPattern = recognizePythonBoolean(returnTokens);
      if (pythonBoolPattern) {
        patterns.push(pythonBoolPattern);
      }
    }

    // 3. Simple comparison (fallback for simple expressions)
    // Only add if no other patterns matched
    if (patterns.length === 0) {
      const compPattern = recognizeComparison(returnTokens);
      if (compPattern) {
        patterns.push(compPattern);
      }
    }
  }

  // Extract variable declarations (person('var_name', period))
  const varDecls = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === PyTokenType.IDENTIFIER && tokens[i].value === 'person') {
      if (tokens[i + 1]?.type === PyTokenType.LPAREN &&
          tokens[i + 2]?.type === PyTokenType.STRING) {
        varDecls.push(tokens[i + 2].value);
      }
    }
  }

  return { patterns, varDecls };
}

// =============================================================================
// COURGETTE GENERATOR
// =============================================================================

function operatorToNatural(op) {
  const mapping = {
    '>=': 'is at least',
    '<=': 'is at most',
    '>': 'is greater than',
    '<': 'is less than',
    '==': 'is',
    '!=': 'is not'
  };
  return mapping[op] || op;
}

// Helper to convert a single condition part to Courgette text
function partToCondition(part) {
  if (part.type === 'variable') {
    return part.name.replace(/_/g, ' ');
  } else if (part.type === 'not_variable') {
    return `not ${part.name.replace(/_/g, ' ')}`;
  } else if (part.type === 'comparison') {
    const naturalOp = operatorToNatural(part.operator);
    return `${part.left.replace(/_/g, ' ')} ${naturalOp} ${part.right}`;
  }
  return null;
}

function patternToCourgette(pattern, indent = '') {
  switch (pattern.type) {
    case 'and':
      // Handle multiplication pattern (factors), logical function (args), or Python bool (args)
      const andItems = pattern.factors || pattern.args || [];
      return andItems.map((f, i) => {
        const prefix = i === 0 ? 'When ' : 'And ';

        // Handle nested comparison or variable from Python bool parsing
        const condText = partToCondition(f);
        if (condText) {
          return `${indent}${prefix}${condText}`;
        }

        if (f.type === 'variable') {
          return `${indent}${prefix}${f.name.replace(/_/g, ' ')}`;
        } else if (f.type === 'group' && f.pattern) {
          const groupLines = [];
          groupLines.push(`${indent}${prefix}any of these are true:`);
          f.pattern.terms.forEach(t => {
            if (t.type === 'variable') {
              groupLines.push(`${indent}  - ${t.name.replace(/_/g, ' ')}`);
            }
          });
          return groupLines.join('\n');
        }
        return '';
      }).filter(s => s).join('\n');

    case 'or':
      // Handle addition pattern (terms), logical function (args), or Python bool (args)
      const orItems = pattern.terms || pattern.args || [];
      return orItems.map((t, i) => {
        const prefix = i === 0 ? 'When ' : 'Or ';

        // Handle nested comparison or variable from Python bool parsing
        const condText = partToCondition(t);
        if (condText) {
          return `${indent}${prefix}${condText}`;
        }

        if (t.type === 'variable') {
          return `${indent}${prefix}${t.name.replace(/_/g, ' ')}`;
        }
        return '';
      }).filter(s => s).join('\n');

    case 'sequence':
      // Mixed and/or - preserve the order with appropriate joiners
      return pattern.parts.map((p, i) => {
        const joiner = p.joinedBy;
        const prefix = i === 0 ? 'When ' : (joiner === 'or' ? 'Or ' : 'And ');
        const condText = partToCondition(p);
        if (condText) {
          return `${indent}${prefix}${condText}`;
        }
        return '';
      }).filter(s => s).join('\n');

    case 'not':
      // Handle logical not (from not_ function)
      const notItems = pattern.args || [];
      if (notItems.length > 0 && notItems[0].type === 'variable') {
        return `${indent}When not ${notItems[0].name.replace(/_/g, ' ')}`;
      }
      return '';

    case 'comparison':
      const naturalOp = operatorToNatural(pattern.operator);
      return `${indent}When ${pattern.left.replace(/_/g, ' ')} ${naturalOp} ${pattern.right}`;

    default:
      return '';
  }
}

function generateCourgette(parsed) {
  const output = [];

  for (const variable of parsed.variables) {
    // Skip non-formula variables
    if (!variable.formulas || variable.formulas.length === 0) {
      continue;
    }

    // Generate scenario header
    const scenarioName = variable.name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    output.push(`Scenario: ${scenarioName}`);

    // Handle temporal versioning (multiple formula methods)
    for (const formula of variable.formulas) {
      // Check for versioned formulas (formula_YYYY_MM_DD)
      const versionMatch = formula.name.match(/formula_(\d{4})_(\d{2})_(\d{2})/);
      if (versionMatch) {
        output.push(`  # Version effective from ${versionMatch[1]}-${versionMatch[2]}-${versionMatch[3]}`);
      }

      const { patterns, varDecls } = recognizePatterns(formula);

      // Generate conditions from patterns
      for (const pattern of patterns) {
        const courgetteCode = patternToCourgette(pattern, '  ');
        if (courgetteCode) {
          output.push(courgetteCode);
        }
      }

      // If no patterns recognized, add comment with variable refs
      if (patterns.length === 0 && varDecls.length > 0) {
        output.push(`  # Uses: ${varDecls.join(', ')}`);
      }
    }

    // Determine outcome based on variable type
    const valueType = variable.attributes?.value_type || 'bool';
    if (valueType === 'bool') {
      output.push(`  Then ${variable.name} is eligible`);
    } else if (valueType === 'float' || valueType === 'int') {
      output.push(`  Then ${variable.name} is calculated`);
    }

    output.push('');
  }

  return output.join('\n');
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

function reverseCompile(pythonSource) {
  const tokens = tokenizePython(pythonSource);
  const parsed = parseOpenFisca(tokens);
  const courgette = generateCourgette(parsed);
  return courgette;
}

// =============================================================================
// EXPORTS
// =============================================================================

// Export for browser
if (typeof window !== 'undefined') {
  window.reverseCompile = reverseCompile;
  window.ReverseCompiler = {
    tokenizePython,
    parseOpenFisca,
    recognizePatterns,
    generateCourgette
  };
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    reverseCompile,
    tokenizePython,
    parseOpenFisca,
    recognizePatterns,
    generateCourgette
  };
}
