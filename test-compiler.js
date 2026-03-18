#!/usr/bin/env node
// Quick tests for the Courgette compiler

const {
  tokenise,
  parse,
  parseCondition,
  compileToOpenFisca
} = require('./compiler.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual:   ${actual}`);
  }
}

function assertIncludes(haystack, needle, message = '') {
  if (!haystack.includes(needle)) {
    throw new Error(`${message}\n  Expected to find: ${needle}\n  In: ${haystack.substring(0, 200)}...`);
  }
}

console.log('=== Tokeniser Tests ===\n');

test('tokenises simple variable', () => {
  const tokens = tokenise('age');
  assertEqual(tokens[0].type, 'IDENTIFIER');
  assertEqual(tokens[0].value, 'age');
});

test('tokenises underscore variable (is_student)', () => {
  const tokens = tokenise('is_student');
  assertEqual(tokens[0].type, 'IDENTIFIER');
  assertEqual(tokens[0].value, 'is_student');
});

test('tokenises natural language operator', () => {
  const tokens = tokenise('age is less than 67');
  assertEqual(tokens[0].value, 'age');
  assertEqual(tokens[1].type, 'OPERATOR');
  assertEqual(tokens[1].value, 'is less than');
  assertEqual(tokens[2].value, 67);
});

test('tokenises money amount', () => {
  const tokens = tokenise('income is less than $60,000');
  assertEqual(tokens[0].value, 'income');
  assertEqual(tokens[1].value, 'is less than');
  assertEqual(tokens[2].type, 'MONEY');
  assertEqual(tokens[2].value, 60000);
});

test('does not mangle is_student with "is" operator', () => {
  const tokens = tokenise('is_student is true');
  assertEqual(tokens[0].type, 'IDENTIFIER');
  assertEqual(tokens[0].value, 'is_student');
  assertEqual(tokens[1].type, 'OPERATOR');
  assertEqual(tokens[1].value, 'is');
});

test('tokenises between syntax', () => {
  const tokens = tokenise('age between 16 and 24');
  assertEqual(tokens[0].value, 'age');
  assertEqual(tokens[1].type, 'KEYWORD');
  assertEqual(tokens[1].value, 'between');
  assertEqual(tokens[2].value, 16);
  assertEqual(tokens[3].type, 'KEYWORD');
  assertEqual(tokens[3].value, 'and');
  assertEqual(tokens[4].value, 24);
});

console.log('\n=== Parser Tests ===\n');

test('parses simple comparison', () => {
  const result = parseCondition('age is less than 67');
  assertEqual(result.code, '(age < 67)');
});

test('parses between expression', () => {
  const result = parseCondition('age between 16 and 24');
  assertEqual(result.code, '(age >= 16) and (age <= 24)');
});

test('parses money comparison', () => {
  const result = parseCondition('parental_income is less than $60,000');
  assertEqual(result.code, '(parental_income < 60000)');
});

test('parses standalone boolean variable', () => {
  const result = parseCondition('is_student');
  assertEqual(result.code, 'is_student');
});

test('parses boolean comparison', () => {
  const result = parseCondition('is_student is true');
  assertEqual(result.code, '(is_student == True)');
});

test('extracts variables correctly', () => {
  const result = parseCondition('age between 16 and 24');
  assertEqual(result.variables.has('age'), true);
  assertEqual(result.variables.size, 1);
});

test('extracts multiple variables', () => {
  const result = parseCondition('income is less than threshold');
  assertEqual(result.variables.has('income'), true);
  assertEqual(result.variables.has('threshold'), true);
});

console.log('\n=== Full Compiler Tests ===\n');

test('compiles simple scenario', () => {
  const input = `Scenario: Youth Allowance
  When age between 16 and 24
  And is_student
  And parental_income is less than $60,000
  Then youth_allowance is eligible
  And payment is $350.50 per fortnight`;

  const output = compileToOpenFisca(input);

  // Check variable definitions
  assertIncludes(output, 'class age(Variable):', 'should define age variable');
  assertIncludes(output, 'class is_student(Variable):', 'should define is_student variable');
  assertIncludes(output, 'class parental_income(Variable):', 'should define parental_income variable');

  // Check eligibility class
  assertIncludes(output, 'class youth_allowance_eligible(Variable):', 'should define eligibility class');

  // Check between is correctly expanded
  assertIncludes(output, '(age >= 16) and (age <= 24)', 'should expand between correctly');

  // Check is_student is not mangled
  assertIncludes(output, 'is_student = person(\'is_student\', period)', 'should not mangle is_student');
  assertIncludes(output, '(is_student)', 'should include is_student in conditions');

  // Check no $ in output
  if (output.includes('$')) {
    throw new Error('Output should not contain $ character');
  }

  // Check payment class
  assertIncludes(output, 'class youth_allowance_payment(Variable):', 'should define payment class');
  assertIncludes(output, 'base_amount = 350.5', 'should set correct payment amount');
});

test('compiles schedule reference', () => {
  const input = `Schedule: Age Pension Rates
  When single: $1096.70 per fortnight
  When couple: $827.10 per fortnight

Scenario: Age Pension
  When age is at least 67
  Then age_pension is eligible
  And rate is determined by Age Pension Rates`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, 'class age_pension_rates_single(Variable):', 'should create schedule variable');
  assertIncludes(output, 'default_value = 1096.7', 'should set schedule value');
});

test('handles Or conditions correctly', () => {
  const input = `Scenario: Test
  When age is at least 67
  Or has_disability is true
  Then eligible is true`;

  const output = compileToOpenFisca(input);

  // Check that 'or' appears in the return statement
  assertIncludes(output, 'or (', 'should use or for Or conditions');
});

test('handles grouped conditions (any of)', () => {
  const input = `Scenario: Test
  When age is at least 16
  And any of these are true:
    - is_student is true
    - is_apprentice is true
  Then eligible is true`;

  const output = compileToOpenFisca(input);

  // Check that the group is OR'd
  assertIncludes(output, ' or ', 'should use or for any-of groups');
  assertIncludes(output, 'is_student', 'should include is_student');
  assertIncludes(output, 'is_apprentice', 'should include is_apprentice');
});

test('handles grouped conditions (all of)', () => {
  const input = `Scenario: Test
  When all of these are true:
    - age is at least 18
    - is_resident is true
  Then eligible is true`;

  const output = compileToOpenFisca(input);

  // Check that the group is AND'd
  assertIncludes(output, ' and ', 'should use and for all-of groups');
});

console.log('\n=== Phase 1: Boolean Precedence Tests ===\n');

test('Or/And precedence generates correct parentheses', () => {
  const input = `Scenario: Test
  When age >= 67
  Or has_disability
  And is_resident
  Then eligible is true`;

  const output = compileToOpenFisca(input);

  // Should generate ((A) or (B)) and (C), not A or B and C
  // The key is that the or-ed expression should be wrapped before and-ing
  // Note: extra parens from comparison wrapping are fine
  assertIncludes(output, ') or (has_disability)) and (is_resident)',
    'should parenthesize for left-to-right evaluation');
});

test('Multiple Or conditions at same level', () => {
  const input = `Scenario: Test
  When condition_a
  Or condition_b
  Or condition_c
  Then eligible is true`;

  const output = compileToOpenFisca(input);

  // Should generate ((A or B) or C)
  assertIncludes(output, 'or (condition_c)', 'should chain or conditions');
});

test('Complex And/Or mix', () => {
  const input = `Scenario: Test
  When age >= 18
  And is_citizen
  Or has_visa
  And is_employed
  Then eligible is true`;

  const output = compileToOpenFisca(input);

  // Should evaluate left-to-right: (((age >= 18) and citizen) or visa) and employed
  assertIncludes(output, ') and (is_employed)', 'final and should wrap all previous');
});

console.log('\n=== Phase 2: Definition Tests ===\n');

test('Definition with "total of" pattern', () => {
  const input = `Definition: assessable_income
  The total of employment_income, investment_income, and deemed_income`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, 'class assessable_income(Variable):', 'should create variable class');
  assertIncludes(output, 'employment_income + investment_income + deemed_income',
    'should generate sum expression');
});

test('Definition with "lower of" pattern', () => {
  const input = `Definition: effective_rate
  The lower of standard_rate and calculated_rate`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, 'class effective_rate(Variable):', 'should create variable class');
  assertIncludes(output, 'min(standard_rate, calculated_rate)', 'should use min function');
});

test('Definition with "higher of" pattern', () => {
  const input = `Definition: guaranteed_minimum
  The higher of base_amount and floor_amount`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, 'max(base_amount, floor_amount)', 'should use max function');
});

test('Definition with "minus" pattern', () => {
  const input = `Definition: net_income
  gross_income minus deductions`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, 'gross_income - deductions', 'should generate subtraction');
});

test('Definition referenced variables are declared', () => {
  const input = `Definition: total_assets
  The total of property_value, savings, and investments`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, "property_value = person('property_value', period)",
    'should declare referenced variables');
  assertIncludes(output, "savings = person('savings', period)",
    'should declare all variables');
});

test('Definition input variables are defined before computed variable', () => {
  const { validateOpenFiscaCode } = require('./compiler.js');

  const input = `Definition: assessable_income
  The total of employment_income, investment_income, and deemed_income`;

  const output = compileToOpenFisca(input);

  // Input variables should appear BEFORE the computed variable
  const empIdx = output.indexOf('class employment_income');
  const assessIdx = output.indexOf('class assessable_income');

  if (empIdx === -1) throw new Error('employment_income class not found');
  if (assessIdx === -1) throw new Error('assessable_income class not found');
  if (empIdx > assessIdx) throw new Error('Input variable should be defined before computed variable');

  // Validation should produce no warnings about undefined variables
  const issues = validateOpenFiscaCode(output);
  const undefinedWarnings = issues.filter(i => i.message.includes('not defined'));
  if (undefinedWarnings.length > 0) {
    throw new Error('Should not have undefined variable warnings: ' + undefinedWarnings.map(i => i.message).join(', '));
  }
});

console.log('\n=== Phase 3: Schedule Condition Tests ===\n');

test('Schedule "single" becomes family_situation comparison', () => {
  const input = `Schedule: Base Rates
  When single: $500 per fortnight
  When couple: $400 per fortnight`;

  const output = compileToOpenFisca(input);

  assertIncludes(output, "class family_situation(Variable):",
    'should define family_situation variable');
});

test('Schedule with complex condition parses correctly', () => {
  const input = `Schedule: Age Rates
  When age >= 65: $600 per fortnight
  When age >= 55: $500 per fortnight`;

  const output = compileToOpenFisca(input);

  // Complex conditions should be parsed as expressions
  assertIncludes(output, 'age_rates_age_65', 'should create schedule variable');
  assertIncludes(output, 'default_value = 600', 'should set correct value');
});

test('Schedule category condition generates enum comparison', () => {
  const input = `Schedule: Payment Rates
  When married: $800 per fortnight

Scenario: Test Payment
  When age is at least 18
  Then eligible is true
  And rate is determined by Payment Rates`;

  const output = compileToOpenFisca(input);

  // The schedule condition should check family_situation, not reference a 'married' variable
  assertIncludes(output, "person('family_situation', period) == 'married'",
    'should generate family_situation comparison for category');
});

console.log('\n=== Phase 4: Reverse Compiler Tests ===\n');

const {
  reverseCompile,
  tokenizePython,
  parseOpenFisca
} = require('./reverse-compiler.js');

test('Tokenizes Python class definition', () => {
  const source = `class my_variable(Variable):
    value_type = bool
    entity = Person`;

  const tokens = tokenizePython(source);

  const classToken = tokens.find(t => t.type === 'KEYWORD' && t.value === 'class');
  if (!classToken) throw new Error('Should find class keyword');

  const identToken = tokens.find(t => t.type === 'IDENTIFIER' && t.value === 'my_variable');
  if (!identToken) throw new Error('Should find class name');
});

test('Parses OpenFisca Variable class', () => {
  const source = `class is_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH

    def formula(person, period, parameters):
        age = person('age', period)
        return age >= 18`;

  const tokens = tokenizePython(source);
  const parsed = parseOpenFisca(tokens);

  assertEqual(parsed.variables.length, 1, 'should find one variable');
  assertEqual(parsed.variables[0].name, 'is_eligible', 'should capture class name');
  assertEqual(parsed.variables[0].formulas.length, 1, 'should find one formula');
});

test('Reverses NZ multiplication pattern', () => {
  const source = `class home_help_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH

    def formula(person, period, parameters):
        is_resident = person('is_resident', period)
        is_citizen = person('is_citizen', period)
        has_disability = person('has_disability', period)
        return is_resident * is_citizen * has_disability`;

  const courgette = reverseCompile(source);

  assertIncludes(courgette, 'Scenario:', 'should generate scenario');
  assertIncludes(courgette, 'is eligible', 'should generate eligibility outcome');
});

test('Reverses comparison operators', () => {
  const source = `class age_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH

    def formula(person, period, parameters):
        age = person('age', period)
        return age >= 65`;

  const courgette = reverseCompile(source);

  assertIncludes(courgette, 'is at least', 'should convert >= to natural language');
});

test('Reverses France logical_and pattern', () => {
  const source = `class rsa_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH

    def formula(person, period, parameters):
        is_resident = person('is_resident', period)
        has_low_income = person('has_low_income', period)
        return and_(is_resident, has_low_income)`;

  const courgette = reverseCompile(source);

  assertIncludes(courgette, 'Scenario:', 'should generate scenario');
});

test('Handles versioned formulas', () => {
  const source = `class benefit_rate(Variable):
    value_type = float
    entity = Person
    definition_period = MONTH

    def formula_2020_01_01(person, period, parameters):
        return 500

    def formula_2018_07_01(person, period, parameters):
        return 450`;

  const courgette = reverseCompile(source);

  assertIncludes(courgette, '2020-01-01', 'should include version date');
  assertIncludes(courgette, '2018-07-01', 'should include older version date');
});

test('Reverses Python native and/or expressions', () => {
  const source = `class complex_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH

    def formula(person, period, parameters):
        age = person('age', period)
        is_resident = person('is_resident', period)
        return age >= 18 and is_resident`;

  const courgette = reverseCompile(source);

  assertIncludes(courgette, 'When age is at least 18', 'should include comparison');
  assertIncludes(courgette, 'And is resident', 'should include second condition with And');
});

test('Reverses Python or expression', () => {
  const source = `class either_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH

    def formula(person, period, parameters):
        has_visa = person('has_visa', period)
        is_citizen = person('is_citizen', period)
        return has_visa or is_citizen`;

  const courgette = reverseCompile(source);

  assertIncludes(courgette, 'When has visa', 'should include first condition');
  assertIncludes(courgette, 'Or is citizen', 'should include second condition with Or');
});

console.log('\n=== All tests complete ===\n');
