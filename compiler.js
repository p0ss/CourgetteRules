// Courgette to OpenFisca Compiler
// Converts plain English Courgette rules to OpenFisca Python code
//
// Architecture: Tokeniser → Parser → AST → Generator
// This avoids the regex replacement issues of the previous approach

// =============================================================================
// TOKENISER
// =============================================================================

const TokenType = {
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  MONEY: 'MONEY',
  OPERATOR: 'OPERATOR',
  KEYWORD: 'KEYWORD',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  EOF: 'EOF'
};

// Multi-word operators must come before single-word to match greedily
const NATURAL_OPERATORS = [
  'is not equal to',
  'is no more than',
  'is no less than',
  'is greater than',
  'is less than',
  'is at least',
  'is at most',
  'is more than',
  'is equal to',
  'is not',
  'is'
];

const KEYWORDS = ['and', 'or', 'not', 'between', 'true', 'false', 'yes', 'no', 'eligible'];
const SYMBOL_OPERATORS = ['==', '!=', '<=', '>=', '<', '>'];

function tokenise(input) {
  const tokens = [];
  let pos = 0;

  function peek(n = 1) {
    return input.substring(pos, pos + n);
  }

  function advance(n = 1) {
    pos += n;
  }

  function skipWhitespace() {
    while (pos < input.length && /\s/.test(input[pos])) {
      pos++;
    }
  }

  function matchNaturalOperator() {
    const remaining = input.substring(pos).toLowerCase();
    for (const op of NATURAL_OPERATORS) {
      if (remaining.startsWith(op)) {
        // Make sure it's a word boundary after the operator
        const afterOp = remaining[op.length];
        if (!afterOp || /\s/.test(afterOp) || /[<>=\d$]/.test(afterOp)) {
          return op;
        }
      }
    }
    return null;
  }

  function matchSymbolOperator() {
    for (const op of SYMBOL_OPERATORS) {
      if (input.substring(pos, pos + op.length) === op) {
        return op;
      }
    }
    return null;
  }

  function readIdentifier() {
    let start = pos;
    while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
      pos++;
    }
    return input.substring(start, pos);
  }

  function readNumber() {
    let start = pos;
    while (pos < input.length && /[\d,.]/.test(input[pos])) {
      pos++;
    }
    return input.substring(start, pos);
  }

  function readString(quote) {
    pos++; // skip opening quote
    let start = pos;
    while (pos < input.length && input[pos] !== quote) {
      pos++;
    }
    const value = input.substring(start, pos);
    pos++; // skip closing quote
    return value;
  }

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    const char = input[pos];

    // Parentheses
    if (char === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(' });
      advance();
      continue;
    }

    if (char === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')' });
      advance();
      continue;
    }

    // Money amount (starts with $)
    if (char === '$') {
      advance(); // skip $
      const numStr = readNumber();
      tokens.push({ type: TokenType.MONEY, value: parseFloat(numStr.replace(/,/g, '')) });
      continue;
    }

    // String literals
    if (char === '"' || char === "'") {
      const value = readString(char);
      tokens.push({ type: TokenType.STRING, value });
      continue;
    }

    // Try natural language operators first (multi-word)
    const naturalOp = matchNaturalOperator();
    if (naturalOp) {
      tokens.push({ type: TokenType.OPERATOR, value: naturalOp });
      advance(naturalOp.length);
      continue;
    }

    // Symbol operators
    const symbolOp = matchSymbolOperator();
    if (symbolOp) {
      tokens.push({ type: TokenType.OPERATOR, value: symbolOp });
      advance(symbolOp.length);
      continue;
    }

    // Numbers (not starting with $)
    if (/\d/.test(char)) {
      const numStr = readNumber();
      tokens.push({ type: TokenType.NUMBER, value: parseFloat(numStr.replace(/,/g, '')) });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      const ident = readIdentifier();
      const lower = ident.toLowerCase();

      if (KEYWORDS.includes(lower)) {
        tokens.push({ type: TokenType.KEYWORD, value: lower });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value: ident });
      }
      continue;
    }

    // Skip unknown characters
    advance();
  }

  tokens.push({ type: TokenType.EOF, value: null });
  return tokens;
}

// =============================================================================
// AST NODE TYPES
// =============================================================================

const NodeType = {
  COMPARISON: 'COMPARISON',
  BETWEEN: 'BETWEEN',
  BINARY_OP: 'BINARY_OP',
  UNARY_OP: 'UNARY_OP',
  VARIABLE: 'VARIABLE',
  LITERAL: 'LITERAL'
};

// =============================================================================
// PARSER
// =============================================================================

function parse(tokens) {
  let pos = 0;

  function current() {
    return tokens[pos] || { type: TokenType.EOF, value: null };
  }

  function peek(n = 1) {
    return tokens[pos + n] || { type: TokenType.EOF, value: null };
  }

  function advance() {
    return tokens[pos++];
  }

  function expect(type) {
    const token = current();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type} (${token.value})`);
    }
    return advance();
  }

  function isOperator(token) {
    return token.type === TokenType.OPERATOR;
  }

  function isKeyword(token, ...values) {
    return token.type === TokenType.KEYWORD && values.includes(token.value);
  }

  // Parse a primary expression (variable, literal, or parenthesized expression)
  function parsePrimary() {
    const token = current();

    if (token.type === TokenType.LPAREN) {
      advance();
      const expr = parseExpression();
      expect(TokenType.RPAREN);
      return expr;
    }

    if (token.type === TokenType.IDENTIFIER) {
      advance();
      return { type: NodeType.VARIABLE, name: token.value };
    }

    if (token.type === TokenType.NUMBER || token.type === TokenType.MONEY) {
      advance();
      return { type: NodeType.LITERAL, value: token.value, dataType: 'number' };
    }

    if (token.type === TokenType.STRING) {
      advance();
      return { type: NodeType.LITERAL, value: token.value, dataType: 'string' };
    }

    if (isKeyword(token, 'true', 'yes', 'eligible')) {
      advance();
      return { type: NodeType.LITERAL, value: true, dataType: 'boolean' };
    }

    if (isKeyword(token, 'false', 'no')) {
      advance();
      return { type: NodeType.LITERAL, value: false, dataType: 'boolean' };
    }

    throw new Error(`Unexpected token: ${token.type} (${token.value})`);
  }

  // Parse a comparison or between expression
  function parseComparison() {
    const left = parsePrimary();

    // Check for 'between' (special ternary operator)
    if (isKeyword(current(), 'between')) {
      advance(); // consume 'between'
      const low = parsePrimary();

      if (isKeyword(current(), 'and')) {
        advance(); // consume 'and'
      }

      const high = parsePrimary();

      return {
        type: NodeType.BETWEEN,
        variable: left,
        low: low,
        high: high
      };
    }

    // Check for comparison operator
    if (isOperator(current())) {
      const op = advance();
      const right = parsePrimary();

      return {
        type: NodeType.COMPARISON,
        left: left,
        operator: normaliseOperator(op.value),
        right: right
      };
    }

    // Standalone variable (implicit boolean check)
    return left;
  }

  // Parse unary NOT
  function parseUnary() {
    if (isKeyword(current(), 'not')) {
      advance();
      const expr = parseUnary();
      return { type: NodeType.UNARY_OP, operator: 'not', operand: expr };
    }
    return parseComparison();
  }

  // Parse AND expressions
  function parseAnd() {
    let left = parseUnary();

    while (isKeyword(current(), 'and')) {
      advance();
      const right = parseUnary();
      left = { type: NodeType.BINARY_OP, operator: 'and', left, right };
    }

    return left;
  }

  // Parse OR expressions (lowest precedence)
  function parseOr() {
    let left = parseAnd();

    while (isKeyword(current(), 'or')) {
      advance();
      const right = parseAnd();
      left = { type: NodeType.BINARY_OP, operator: 'or', left, right };
    }

    return left;
  }

  function parseExpression() {
    return parseOr();
  }

  // Handle case where we just have a standalone identifier (boolean variable)
  if (current().type === TokenType.EOF) {
    return null;
  }

  return parseExpression();
}

// Normalise operator strings to Python operators
function normaliseOperator(op) {
  const normalised = op.toLowerCase();
  const mapping = {
    'is less than': '<',
    'is greater than': '>',
    'is at least': '>=',
    'is at most': '<=',
    'is more than': '>',
    'is no more than': '<=',
    'is no less than': '>=',
    'is equal to': '==',
    'is not equal to': '!=',
    'is not': '!=',
    'is': '=='
  };
  return mapping[normalised] || op;
}

// =============================================================================
// CODE GENERATOR
// =============================================================================

function generateConditionCode(ast, indent = '') {
  if (!ast) return 'True';

  switch (ast.type) {
    case NodeType.LITERAL:
      if (ast.dataType === 'boolean') {
        return ast.value ? 'True' : 'False';
      }
      if (ast.dataType === 'string') {
        return `'${ast.value}'`;
      }
      return String(ast.value);

    case NodeType.VARIABLE:
      return ast.name;

    case NodeType.COMPARISON:
      const left = generateConditionCode(ast.left);
      const right = generateConditionCode(ast.right);
      return `(${left} ${ast.operator} ${right})`;

    case NodeType.BETWEEN:
      const varName = generateConditionCode(ast.variable);
      const low = generateConditionCode(ast.low);
      const high = generateConditionCode(ast.high);
      return `(${varName} >= ${low}) and (${varName} <= ${high})`;

    case NodeType.BINARY_OP:
      const leftExpr = generateConditionCode(ast.left);
      const rightExpr = generateConditionCode(ast.right);
      return `(${leftExpr} ${ast.operator} ${rightExpr})`;

    case NodeType.UNARY_OP:
      const operand = generateConditionCode(ast.operand);
      return `(not ${operand})`;

    default:
      throw new Error(`Unknown AST node type: ${ast.type}`);
  }
}

// Extract all variable names from an AST
function extractVariablesFromAST(ast, variables = new Set()) {
  if (!ast) return variables;

  switch (ast.type) {
    case NodeType.VARIABLE:
      variables.add(ast.name);
      break;

    case NodeType.COMPARISON:
      extractVariablesFromAST(ast.left, variables);
      extractVariablesFromAST(ast.right, variables);
      break;

    case NodeType.BETWEEN:
      extractVariablesFromAST(ast.variable, variables);
      extractVariablesFromAST(ast.low, variables);
      extractVariablesFromAST(ast.high, variables);
      break;

    case NodeType.BINARY_OP:
      extractVariablesFromAST(ast.left, variables);
      extractVariablesFromAST(ast.right, variables);
      break;

    case NodeType.UNARY_OP:
      extractVariablesFromAST(ast.operand, variables);
      break;
  }

  return variables;
}

// =============================================================================
// CONDITION PARSING (high-level wrapper)
// =============================================================================

function parseCondition(conditionText) {
  try {
    const tokens = tokenise(conditionText);
    const ast = parse(tokens);
    return {
      ast: ast,
      code: generateConditionCode(ast),
      variables: extractVariablesFromAST(ast)
    };
  } catch (e) {
    // Fallback for unparseable conditions - return as-is with warning
    console.warn(`Could not parse condition: "${conditionText}"`, e.message);
    return {
      ast: null,
      code: conditionText,
      variables: new Set(),
      error: e.message
    };
  }
}

// =============================================================================
// OUTCOME PARSING
// =============================================================================

function parseOutcome(outcome) {
  // Extract eligibility rules - support natural language
  const eligibilityPatterns = [
    /(\w+)\s*=\s*true/i,
    /(\w+)\s+is\s+eligible/i,
    /(\w+)\s+is\s+yes/i,
    /(\w+)\s+is\s+true/i
  ];

  for (const pattern of eligibilityPatterns) {
    const match = outcome.match(pattern);
    if (match) {
      return {
        type: 'eligibility',
        variable: match[1],
        value: true
      };
    }
  }

  const paymentMatch = outcome.match(/payment\s+is\s+\$?([\d,._]+)(?:\s+per\s+(\w+))?/i);
  if (paymentMatch) {
    return {
      type: 'payment',
      amount: parseFloat(paymentMatch[1].replace(/[,_]/g, '')),
      period: paymentMatch[2] || 'fortnight'
    };
  }

  const scheduleMatch = outcome.match(/rate\s+is\s+determined\s+by\s+(.+)/i);
  if (scheduleMatch) {
    return {
      type: 'schedule',
      schedule: scheduleMatch[1].trim()
    };
  }

  const reductionMatch = outcome.match(/payment\s+reduces\s+by\s+(\d+)\s+cents\s+per\s+dollar\s+over\s+\$?([\d,._]+)/i);
  if (reductionMatch) {
    return {
      type: 'reduction',
      cents: parseInt(reductionMatch[1]),
      threshold: parseFloat(reductionMatch[2].replace(/[,_]/g, ''))
    };
  }

  return { type: 'unknown', text: outcome };
}

// =============================================================================
// VARIABLE TYPE INFERENCE
// =============================================================================

function guessVariableType(variable) {
  const varLower = variable.toLowerCase();

  // Age variables - change daily (birthdays)
  if (varLower.includes('age')) {
    return { type: 'int', period: 'DAY' };
  }

  // Boolean indicators - most change monthly
  if (varLower.startsWith('is_') || varLower.startsWith('has_') ||
      varLower.includes('eligible') || varLower === 'studying') {
    return { type: 'bool', period: 'MONTH' };
  }

  // Residence/citizenship - these are more permanent
  if (varLower.includes('resident') || varLower.includes('citizen')) {
    return { type: 'bool', period: 'ETERNITY' };
  }

  // Years of residence - this changes yearly
  if (varLower.includes('years') || varLower.includes('_years')) {
    return { type: 'int', period: 'YEAR' };
  }

  // Status/category variables
  if (varLower.includes('status') || varLower.includes('type') ||
      varLower.includes('category') || varLower === 'family_situation') {
    return { type: 'str', period: 'MONTH' };
  }

  // Income/money variables - typically assessed monthly
  if (varLower.includes('income') || varLower.includes('payment') ||
      varLower.includes('amount') || varLower.includes('rate') ||
      varLower.includes('asset') || varLower.includes('value')) {
    return { type: 'float', period: 'MONTH' };
  }

  // Default
  return { type: 'float', period: 'MONTH' };
}

// =============================================================================
// CODE GENERATION
// =============================================================================

function generateVariableDefinitions(variables) {
  let code = '# Variable definitions\n';

  variables.forEach(variable => {
    const varInfo = guessVariableType(variable);

    code += `
class ${variable}(Variable):
    value_type = ${varInfo.type}
    entity = Person
    definition_period = ${varInfo.period}
    label = "${variable.replace(/_/g, ' ')}"
`;
  });

  return code;
}

function generateScheduleParameters(schedules) {
  let code = '# Schedule parameters as variables\n';

  schedules.forEach((entries, scheduleName) => {
    const paramName = scheduleName.toLowerCase().replace(/\s+/g, '_');

    entries.forEach(entry => {
      const conditionName = entry.condition.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const varName = `${paramName}_${conditionName}`;

      code += `
class ${varName}(Variable):
    value_type = float
    entity = Person
    definition_period = ETERNITY
    label = "${scheduleName} - ${entry.condition}"
    default_value = ${entry.amount}
`;
    });
  });

  return code;
}

// =============================================================================
// DEFINITION CODE GENERATION
// =============================================================================

// Pattern matching for definition expressions
const DEFINITION_PATTERNS = [
  {
    // "the total of X, Y, and Z" or "total of X, Y and Z"
    pattern: /^(?:the\s+)?total\s+of\s+(.+)$/i,
    type: 'sum'
  },
  {
    // "the lower of X and Y" or "lower of X and Y"
    pattern: /^(?:the\s+)?lower\s+of\s+(.+?)\s+and\s+(.+)$/i,
    type: 'min'
  },
  {
    // "the higher of X and Y" or "higher of X and Y"
    pattern: /^(?:the\s+)?higher\s+of\s+(.+?)\s+and\s+(.+)$/i,
    type: 'max'
  },
  {
    // "X minus Y"
    pattern: /^(.+?)\s+minus\s+(.+)$/i,
    type: 'subtract'
  },
  {
    // "X plus Y"
    pattern: /^(.+?)\s+plus\s+(.+)$/i,
    type: 'add'
  },
  {
    // "X multiplied by Y" or "X times Y"
    pattern: /^(.+?)\s+(?:multiplied\s+by|times)\s+(.+)$/i,
    type: 'multiply'
  },
  {
    // "X divided by Y"
    pattern: /^(.+?)\s+divided\s+by\s+(.+)$/i,
    type: 'divide'
  }
];

function parseDefinitionExpression(content) {
  const text = content.join(' ').trim();

  for (const { pattern, type } of DEFINITION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (type === 'sum') {
        // Parse comma-separated list with optional "and"
        const itemsText = match[1];
        const items = itemsText
          .split(/,\s*(?:and\s+)?|\s+and\s+/)
          .map(s => s.trim().replace(/\s+/g, '_'))
          .filter(s => s.length > 0);
        return { type: 'sum', variables: items };
      } else if (type === 'min' || type === 'max') {
        const var1 = match[1].trim().replace(/\s+/g, '_');
        const var2 = match[2].trim().replace(/\s+/g, '_');
        return { type, variables: [var1, var2] };
      } else if (type === 'subtract' || type === 'add' || type === 'multiply' || type === 'divide') {
        const var1 = match[1].trim().replace(/\s+/g, '_');
        const var2 = match[2].trim().replace(/\s+/g, '_');
        return { type, variables: [var1, var2] };
      }
    }
  }

  // If no pattern matched, return the raw content
  return { type: 'unknown', text };
}

function generateDefinitionCode(definitions, allVariables) {
  let code = '';

  definitions.forEach((content, name) => {
    if (content.length === 0) return;

    const parsed = parseDefinitionExpression(content);
    const varInfo = guessVariableType(name);
    const varName = name.replace(/\s+/g, '_').toLowerCase();

    // Add referenced variables to allVariables
    if (parsed.variables) {
      parsed.variables.forEach(v => allVariables.add(v));
    }

    code += `
class ${varName}(Variable):
    value_type = ${varInfo.type}
    entity = Person
    definition_period = ${varInfo.period}
    label = "${name.replace(/_/g, ' ')}"

    def formula(person, period, parameters):
`;

    // Generate variable declarations
    if (parsed.variables) {
      parsed.variables.forEach(v => {
        code += `        ${v} = person('${v}', period)\n`;
      });
    }

    // Generate formula based on type
    code += '\n';
    switch (parsed.type) {
      case 'sum':
        code += `        return ${parsed.variables.join(' + ')}\n`;
        break;
      case 'min':
        code += `        return min(${parsed.variables[0]}, ${parsed.variables[1]})\n`;
        break;
      case 'max':
        code += `        return max(${parsed.variables[0]}, ${parsed.variables[1]})\n`;
        break;
      case 'subtract':
        code += `        return ${parsed.variables[0]} - ${parsed.variables[1]}\n`;
        break;
      case 'add':
        code += `        return ${parsed.variables[0]} + ${parsed.variables[1]}\n`;
        break;
      case 'multiply':
        code += `        return ${parsed.variables[0]} * ${parsed.variables[1]}\n`;
        break;
      case 'divide':
        code += `        return ${parsed.variables[0]} / ${parsed.variables[1]}\n`;
        break;
      default:
        code += `        # Unable to parse: ${parsed.text || content.join(' ')}\n`;
        code += `        return 0\n`;
    }
  });

  return code;
}

// Known family situation category values
// These should become family_situation comparisons, not variable references
const FAMILY_CATEGORIES = [
  'single', 'couple', 'partnered', 'married', 'de_facto',
  'separated', 'divorced', 'widowed', 'single_parent',
  'couple_with_children', 'single_with_children'
];

function parseScheduleCondition(condition) {
  const normalized = condition.toLowerCase().replace(/\s+/g, '_');

  // Check if this is a known family category value
  if (FAMILY_CATEGORIES.includes(normalized)) {
    return `person('family_situation', period) == '${normalized}'`;
  }

  // Use the proper parser for schedule conditions
  const parsed = parseCondition(condition);

  // If the AST is just a simple variable (identifier), treat it as a category
  // This handles cases like "single" which parses as a valid identifier
  if (parsed.ast && parsed.ast.type === NodeType.VARIABLE) {
    return `person('family_situation', period) == '${normalized}'`;
  }

  // If it has operators (comparison, binary op, etc.), parse as expression
  if (parsed.ast && parsed.ast.type !== NodeType.VARIABLE) {
    return wrapVariablesInPersonCalls(parsed.code, parsed.variables);
  }

  // Fallback for unparseable conditions - treat as category
  return `person('family_situation', period) == '${normalized}'`;
}

function wrapVariablesInPersonCalls(code, variables) {
  let result = code;
  // Sort by length descending to replace longer names first
  const sortedVars = Array.from(variables).sort((a, b) => b.length - a.length);

  for (const varName of sortedVars) {
    // Use word boundary matching to avoid partial replacements
    const regex = new RegExp(`\\b${varName}\\b`, 'g');
    result = result.replace(regex, `person('${varName}', period)`);
  }

  return result;
}

// Build condition expression with proper left-to-right precedence
// This fixes the boolean logic ambiguity where:
//   When A / Or B / And C
// Should produce: ((A) or (B)) and (C)
// NOT: A or B and C (which Python evaluates as A or (B and C))
function buildConditionExpression(parsedConditions) {
  if (parsedConditions.length === 0) {
    return 'True';
  }

  // Convert each parsed condition to its code representation
  function conditionToCode(pc) {
    if (pc.type === 'group_start') {
      if (pc.items.length === 0) {
        return null;
      }
      const groupJoiner = pc.groupType === 'or' ? ' or ' : ' and ';
      const groupCode = pc.items.map(item => `(${item.code})`).join(groupJoiner);
      if (pc.groupType === 'none') {
        return `(not (${groupCode}))`;
      }
      return `(${groupCode})`;
    }
    return `(${pc.code})`;
  }

  // Build expression with left-to-right precedence using explicit parentheses
  // Start with the first condition
  let result = conditionToCode(parsedConditions[0]);
  if (result === null) {
    return 'True';
  }

  // For each subsequent condition, wrap the accumulated result with the new condition
  for (let i = 1; i < parsedConditions.length; i++) {
    const pc = parsedConditions[i];
    const condCode = conditionToCode(pc);
    if (condCode === null) continue;

    const joiner = pc.joiner || 'and';
    // Always parenthesize the left side to enforce left-to-right evaluation
    result = `(${result}) ${joiner} ${condCode}`;
  }

  return result;
}

function generateScenarioCode(name, parsedConditions, outcomes, allVariables, schedules) {
  const className = name.replace(/\s+/g, '_').toLowerCase();

  // Separate eligibility outcomes from payment outcomes
  const eligibilityOutcome = outcomes.find(o => o.type === 'eligibility');
  const paymentOutcomes = outcomes.filter(o => o.type !== 'eligibility');

  // Collect variables used in this scenario
  const scenarioVariables = new Set();
  parsedConditions.forEach(pc => {
    if (pc.type === 'group_start') {
      // Collect variables from group items
      pc.items.forEach(item => {
        if (item.variables) {
          item.variables.forEach(v => scenarioVariables.add(v));
        }
      });
    } else if (pc.variables) {
      pc.variables.forEach(v => scenarioVariables.add(v));
    }
  });

  let code = `
class ${className}_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH
    label = "${name} eligibility"
    documentation = """
    ${name} eligibility conditions.
    """

    def formula(person, period, parameters):
`;

  // Generate variable declarations
  scenarioVariables.forEach(varName => {
    code += `        ${varName} = person('${varName}', period)\n`;
  });

  if (parsedConditions.length > 0) {
    // Build condition expression with proper left-to-right precedence
    // When A / Or B / And C should become ((A) or (B)) and (C)
    // NOT A or B and C which Python evaluates as A or (B and C)
    const conditionExpr = buildConditionExpression(parsedConditions);
    code += `\n        return ${conditionExpr}\n`;
  } else {
    code += '        return True\n';
  }

  // Generate payment calculation if applicable
  const paymentOutcome = paymentOutcomes.find(o => o.type === 'payment');
  const scheduleOutcome = paymentOutcomes.find(o => o.type === 'schedule');
  const reductionOutcomes = paymentOutcomes.filter(o => o.type === 'reduction');

  if (paymentOutcome || scheduleOutcome || reductionOutcomes.length > 0) {
    code += `

class ${className}_payment(Variable):
    value_type = float
    entity = Person
    definition_period = MONTH
    label = "${name} payment amount"
    documentation = """
    ${name} payment calculation.
    """

    def formula(person, period, parameters):
        eligible = person('${className}_eligible', period)

        if not eligible:
            return 0

`;

    if (paymentOutcome) {
      code += `        # Base payment amount\n`;
      code += `        base_amount = ${paymentOutcome.amount}\n`;
    } else if (scheduleOutcome) {
      const schedule = schedules.get(scheduleOutcome.schedule);
      if (schedule && schedule.length > 0) {
        code += `        # Payment from schedule: ${scheduleOutcome.schedule}\n`;

        schedule.forEach((entry, idx) => {
          const conditionCode = parseScheduleCondition(entry.condition);
          const paramName = scheduleOutcome.schedule.toLowerCase().replace(/\s+/g, '_');
          const conditionName = entry.condition.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const varName = `${paramName}_${conditionName}`;

          if (idx === 0) {
            code += `        if ${conditionCode}:\n`;
            code += `            base_amount = person('${varName}', period)\n`;
          } else {
            code += `        elif ${conditionCode}:\n`;
            code += `            base_amount = person('${varName}', period)\n`;
          }
        });
        code += `        else:\n`;
        code += `            base_amount = 0\n`;
      } else {
        code += `        # Schedule not found\n`;
        code += `        base_amount = 0\n`;
      }
    } else {
      code += `        base_amount = 0\n`;
    }

    if (reductionOutcomes.length > 0) {
      code += `
        # Apply income test reductions
        income = person('income', period)\n`;
      reductionOutcomes.forEach(reduction => {
        code += `        if income > ${reduction.threshold}:\n`;
        code += `            base_amount = max(0, base_amount - (income - ${reduction.threshold}) * ${reduction.cents / 100})\n`;
      });
    }

    code += `
        return base_amount\n`;
  }

  return code;
}

// =============================================================================
// MAIN COMPILER
// =============================================================================

function compileToOpenFisca(courgette) {
  const lines = courgette.split('\n');

  let scenarios = [];
  let currentScenario = null;
  let currentDefinition = null;
  let currentSchedule = null;
  let allVariables = new Set();
  let parsedConditions = [];
  let outcomes = [];
  let inConditions = true;
  let schedules = new Map();
  let definitions = new Map(); // Store definition name -> content

  // Parse all content
  lines.forEach(line => {
    const trimmed = line.trim();

    if (trimmed.startsWith('Scenario:')) {
      // Save previous scenario
      if (currentScenario) {
        scenarios.push({
          name: currentScenario,
          parsedConditions: [...parsedConditions],
          outcomes: [...outcomes]
        });
      }

      currentScenario = trimmed.substring(9).trim();
      parsedConditions = [];
      outcomes = [];
      inConditions = true;
      currentSchedule = null;
      currentDefinition = null;

    } else if (trimmed.startsWith('Definition:')) {
      currentDefinition = trimmed.substring(11).trim();
      currentSchedule = null;
      currentScenario = null; // Exit scenario mode
      definitions.set(currentDefinition, []);

    } else if (currentDefinition && trimmed && !trimmed.startsWith('Scenario:') && !trimmed.startsWith('Schedule:') && !trimmed.startsWith('Definition:')) {
      // Collect definition content lines
      definitions.get(currentDefinition).push(trimmed);

    } else if (trimmed.startsWith('Schedule:')) {
      currentSchedule = trimmed.substring(9).trim();
      schedules.set(currentSchedule, []);
      currentDefinition = null;

    } else if (currentSchedule && trimmed.startsWith('When ')) {
      // Parse schedule entries
      const match = trimmed.match(/^When\s+(.+?):\s*\$?([\d,._]+)(?:\s+per\s+(\w+))?$/);
      if (match) {
        const [, condition, amount, period] = match;
        schedules.get(currentSchedule).push({
          condition: condition,
          amount: parseFloat(amount.replace(/[,_]/g, '')),
          period: period || 'fortnight'
        });
      }

    } else if (currentScenario) {
      // Parse conditions and outcomes
      if (trimmed.match(/^(When|Given|And)\s+/) && inConditions) {
        const conditionText = trimmed.replace(/^(When|Given|And)\s+/, '');

        // Check for grouped conditions
        if (conditionText.match(/^(any|all|none)\s+of\s+(these|the following)\s+(are\s+true|apply)/i)) {
          // Mark that we're expecting list items with specific grouping
          const groupType = conditionText.toLowerCase().startsWith('any') ? 'or' :
                           conditionText.toLowerCase().startsWith('none') ? 'none' : 'and';
          parsedConditions.push({
            type: 'group_start',
            groupType: groupType,
            items: []
          });
        } else if (conditionText && !conditionText.includes(':')) {
          const parsed = parseCondition(conditionText);
          parsed.joiner = 'and';
          parsedConditions.push(parsed);
          parsed.variables.forEach(v => allVariables.add(v));
        }
      } else if (trimmed.startsWith('Or ') && inConditions) {
        const conditionText = trimmed.replace(/^Or\s+/, '');
        if (conditionText && !conditionText.includes(':')) {
          const parsed = parseCondition(conditionText);
          parsed.joiner = 'or';
          parsedConditions.push(parsed);
          parsed.variables.forEach(v => allVariables.add(v));
        }
      } else if (trimmed.match(/^(Then|And)\s+/)) {
        inConditions = false;
        const outcome = trimmed.replace(/^(Then|And)\s+/, '');
        outcomes.push(parseOutcome(outcome));
      } else if (trimmed.startsWith('-')) {
        const item = trimmed.substring(1).trim();
        if (inConditions) {
          const parsed = parseCondition(item);
          parsed.variables.forEach(v => allVariables.add(v));

          // Check if we're inside a group
          const lastCondition = parsedConditions[parsedConditions.length - 1];
          if (lastCondition && lastCondition.type === 'group_start') {
            lastCondition.items.push(parsed);
          } else {
            parsed.joiner = 'and';
            parsedConditions.push(parsed);
          }
        }
      }
    }
  });

  // Save final scenario
  if (currentScenario) {
    scenarios.push({
      name: currentScenario,
      parsedConditions: parsedConditions,
      outcomes: outcomes
    });
  }

  // Check if any schedule entries use family categories
  // If so, add family_situation to the variable list
  schedules.forEach((entries) => {
    entries.forEach(entry => {
      const normalized = entry.condition.toLowerCase().replace(/\s+/g, '_');
      if (FAMILY_CATEGORIES.includes(normalized)) {
        allVariables.add('family_situation');
      }
    });
  });

  // Extract variables from definitions BEFORE generating variable definitions
  // This ensures input variables for definitions are declared
  definitions.forEach((content, name) => {
    if (content.length > 0) {
      const parsed = parseDefinitionExpression(content);
      if (parsed.variables) {
        parsed.variables.forEach(v => allVariables.add(v));
      }
    }
  });

  // Build output with proper ordering
  let output = `"""
Generated OpenFisca code from Courgette rules
Created: ${new Date().toLocaleDateString('en-AU')}

Note: This generated code should be validated with OpenFisca's type checker
Run: openfisca test [this_file.py] --verbose
"""

from openfisca_core.model_api import *
from openfisca_core.periods import MONTH, YEAR, DAY, ETERNITY

`;

  // Generate variable definitions (now includes definition input variables)
  output += generateVariableDefinitions(allVariables);
  output += '\n';

  // Generate schedule parameters if any
  if (schedules.size > 0) {
    output += generateScheduleParameters(schedules);
    output += '\n';
  }

  // Generate definition-based variables if any
  if (definitions.size > 0) {
    output += '# Computed variables from definitions\n';
    output += generateDefinitionCode(definitions, allVariables);
    output += '\n';
  }

  // Generate scenario code
  scenarios.forEach(scenario => {
    output += generateScenarioCode(
      scenario.name,
      scenario.parsedConditions,
      scenario.outcomes,
      allVariables,
      schedules
    );
  });

  return output;
}

// =============================================================================
// VALIDATION
// =============================================================================

function validateOpenFiscaCode(code) {
  const issues = [];
  const lines = code.split('\n');

  const definedClasses = new Set();
  const definedVariables = new Set();
  const referencedVariables = new Set();

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Check class definitions
    if (trimmed.startsWith('class ') && trimmed.includes('(Variable):')) {
      const className = trimmed.match(/class\s+(\w+)\(/);
      if (className) {
        definedClasses.add(className[1]);
        definedVariables.add(className[1]);
      }
    }

    // Check for person() calls
    const personCalls = line.matchAll(/person\(['"](\w+)['"]/g);
    for (const match of personCalls) {
      referencedVariables.add(match[1]);
    }

    // Check for syntax issues
    if (trimmed.includes('$')) {
      issues.push({
        line: lineNum,
        message: 'Invalid character "$" in Python code',
        severity: 'error'
      });
    }
  });

  // Check for referenced but undefined variables
  referencedVariables.forEach(varName => {
    if (!definedVariables.has(varName) && !['income'].includes(varName)) {
      issues.push({
        message: `Variable '${varName}' is referenced but not defined`,
        severity: 'warning'
      });
    }
  });

  return issues;
}

// =============================================================================
// EXPORTS
// =============================================================================

// Export for browser
if (typeof window !== 'undefined') {
  window.compileToOpenFisca = compileToOpenFisca;
  window.validateOpenFiscaCode = validateOpenFiscaCode;

  // Also export internals for testing
  window.CourgetteCompiler = {
    tokenise,
    parse,
    parseCondition,
    generateConditionCode,
    extractVariablesFromAST
  };
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compileToOpenFisca,
    validateOpenFiscaCode,
    tokenise,
    parse,
    parseCondition,
    generateConditionCode,
    extractVariablesFromAST
  };
}
