// Courgette to OpenFisca Compiler
// Converts plain English Courgette rules to OpenFisca Python code

// Natural language to Python operator conversion
function parseCondition(condition) {
  // First, convert natural language operators to symbols
  let parsed = condition
    // Natural language operators (must come before symbol replacements)
    .replace(/\bis\s+less\s+than\b/gi, '<')
    .replace(/\bis\s+greater\s+than\b/gi, '>')
    .replace(/\bis\s+at\s+least\b/gi, '>=')
    .replace(/\bis\s+at\s+most\b/gi, '<=')
    .replace(/\bis\s+more\s+than\b/gi, '>')
    .replace(/\bis\s+no\s+more\s+than\b/gi, '<=')
    .replace(/\bis\s+no\s+less\s+than\b/gi, '>=')
    .replace(/\bis\s+equal\s+to\b/gi, '==')
    .replace(/\bis\s+not\s+equal\s+to\b/gi, '!=')
    .replace(/\bis\s+not\b/gi, '!=')
    .replace(/\bis\b(?!\s+(less|greater|at|more|no|equal|not))/gi, '==');
  
  // Handle between before other conversions
  const betweenMatch = parsed.match(/(\w+)\s+between\s+(\S+)\s+and\s+(\S+)/i);
  if (betweenMatch) {
    const [fullMatch, varName, low, high] = betweenMatch;
    parsed = parsed.replace(fullMatch, `${varName} >= ${low}) and (${varName} <= ${high}`);
  }
  
  // Then handle remaining conversions
  parsed = parsed
    .replace(/\s*==\s*/g, ' == ')
    .replace(/\s*!=\s*/g, ' != ')
    .replace(/\s*<=\s*/g, ' <= ')
    .replace(/\s*>=\s*/g, ' >= ')
    .replace(/\s*<\s*/g, ' < ')
    .replace(/\s*>\s*/g, ' > ')
    .replace(/\$?([\d,]+(?:\.\d+)?)/g, '$1') // Remove $ from amounts
    .replace(/,/g, '') // Remove commas from numbers
    .replace(/\btrue\b/gi, 'True')
    .replace(/\bfalse\b/gi, 'False')
    .replace(/\byes\b/gi, 'True')
    .replace(/\bno\b/gi, 'False')
    .replace(/\beligible\b/gi, 'True')
    .replace(/"([^"]+)"/g, "'$1'");
  
  return parsed;
}

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

function extractVariables(text, variables) {
  // First remove money amounts and quoted strings to avoid extracting them
  let cleanText = text
    .replace(/\$[\d,]+(?:\.\d+)?/g, '') // Remove money amounts
    .replace(/"[^"]*"/g, '') // Remove quoted strings
    .replace(/'[^']*'/g, ''); // Remove single quoted strings
  
  // Extract variable names from conditions
  const matches = cleanText.match(/\b[a-zA-Z_]\w*\b/g);
  if (matches) {
    matches.forEach(match => {
      // Extended exclusion list
      const excludeWords = [
        // Boolean values
        'true', 'false', 'yes', 'no', 'eligible',
        // Logical operators
        'and', 'or', 'not', 'between', 
        // Verbs
        'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have',
        // Comparison words
        'less', 'greater', 'than', 'at', 'least', 'most', 'more', 'equal', 'to',
        // Payment-related words
        'per', 'by', 'cents', 'cent', 'dollar', 'dollars', 'over', 'under',
        'payment', 'payments', 'rate', 'rates', 'reduces', 'reduced', 'reduction',
        'amount', 'base', 'maximum', 'minimum',
        // Time periods
        'fortnight', 'fortnightly', 'week', 'weekly', 'month', 'monthly', 
        'year', 'yearly', 'annual', 'annually', 'day', 'daily',
        // Other common words in rules
        'all', 'any', 'of', 'these', 'are', 'the', 'a', 'an',
        'then', 'when', 'given', 'and', 'or', 'if'
      ];
      
      if (!excludeWords.includes(match.toLowerCase()) && !match.match(/^\d/)) {
        variables.add(match);
      }
    });
  }
}

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
      varLower.includes('category')) {
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

function generateVariableDefinitions(variables) {
  let code = '# Variable definitions\n';
  
  variables.forEach(variable => {
    const varInfo = guessVariableType(variable);
    const valueType = varInfo.type === 'int' ? 'int' : varInfo.type === 'str' ? 'str' : varInfo.type;
    
    code += `
class ${variable}(Variable):
    value_type = ${valueType}
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
      // Create a variable for each schedule condition
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

function parseScheduleCondition(condition) {
  // Parse schedule conditions like "youngest_child_age is less than 5"
  let parsed = condition;
  
  // Handle "between X and Y" format
  const betweenMatch = condition.match(/(\w+)\s+between\s+(\d+)\s+and\s+(\d+)/i);
  if (betweenMatch) {
    const [, varName, low, high] = betweenMatch;
    return `person('${varName}', period) >= ${low} and person('${varName}', period) <= ${high}`;
  }
  
  // Handle natural language comparisons
  parsed = parsed
    .replace(/(\w+)\s+is\s+less\s+than\s+(\d+)/gi, "person('$1', period) < $2")
    .replace(/(\w+)\s+is\s+greater\s+than\s+(\d+)/gi, "person('$1', period) > $2")
    .replace(/(\w+)\s+is\s+at\s+least\s+(\d+)/gi, "person('$1', period) >= $2")
    .replace(/(\w+)\s+is\s+at\s+most\s+(\d+)/gi, "person('$1', period) <= $2")
    .replace(/(\w+)\s+<\s+(\d+)/g, "person('$1', period) < $2")
    .replace(/(\w+)\s+>\s+(\d+)/g, "person('$1', period) > $2")
    .replace(/(\w+)\s+<=\s+(\d+)/g, "person('$1', period) <= $2")
    .replace(/(\w+)\s+>=\s+(\d+)/g, "person('$1', period) >= $2");
  
  // Handle simple equality conditions
  if (!parsed.includes('person(')) {
    // Assume it's a simple condition like "single" or "couple"
    return `person('family_situation', period) == '${condition}'`;
  }
  
  return parsed;
}

function generateScenarioCode(name, conditions, outcomes, variables, schedules) {
  const className = name.replace(/\s+/g, '_').toLowerCase();
  
  // Separate eligibility outcomes from payment outcomes
  const eligibilityOutcome = outcomes.find(o => o.type === 'eligibility');
  const paymentOutcomes = outcomes.filter(o => o.type !== 'eligibility');
  
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
  
  // Generate variable declarations from conditions only
  const usedVars = new Set();
  conditions.forEach(condition => {
    // Extract all variable names from the parsed condition
    const varMatches = condition.match(/\b[a-zA-Z_]\w*\b/g) || [];
    varMatches.forEach(varName => {
      if (!['True', 'False', 'and', 'or', 'not'].includes(varName) && 
          !varName.match(/^\d/) && !usedVars.has(varName)) {
        usedVars.add(varName);
        code += `        ${varName} = person('${varName}', period)\n`;
      }
    });
  });
  
  if (conditions.length > 0) {
    code += '\n        return (\n';
    conditions.forEach((condition, idx) => {
      // Fix spacing in operators and handle between syntax properly
      let fixedCondition = condition
        .replace(/\s+([<>=]+)\s+/g, ' $1 ');
      
      // Handle between syntax - replace variable in second part
      const betweenVarMatch = fixedCondition.match(/(\w+)\s*>=\s*\d+\)\s*and\s*\((\w+)\s*<=\s*\d+/);
      if (betweenVarMatch && betweenVarMatch[1]) {
        fixedCondition = fixedCondition.replace(betweenVarMatch[2], betweenVarMatch[1]);
      }
      
      code += `            ${idx > 0 ? 'and ' : ''}(${fixedCondition})\n`;
    });
    code += '        )\n';
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
        
        // Generate conditional logic for schedule
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

// Courgette to OpenFisca compiler
function compileToOpenFisca(courgette) {
  const lines = courgette.split('\n');
  
  let scenarios = [];
  let currentScenario = null;
  let currentDefinition = null;
  let currentSchedule = null;
  let variables = new Set();
  let conditions = [];
  let outcomes = [];
  let inConditions = true;
  let schedules = new Map();
  
  // Parse all content
  lines.forEach(line => {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('Scenario:')) {
      // Save previous scenario
      if (currentScenario) {
        scenarios.push({
          name: currentScenario,
          conditions: [...conditions],
          outcomes: [...outcomes]
        });
      }
      
      currentScenario = trimmed.substring(9).trim();
      conditions = [];
      outcomes = [];
      inConditions = true;
      currentSchedule = null;
      
    } else if (trimmed.startsWith('Definition:')) {
      currentDefinition = trimmed.substring(11).trim();
      currentSchedule = null;
      
    } else if (trimmed.startsWith('Schedule:')) {
      currentSchedule = trimmed.substring(9).trim();
      schedules.set(currentSchedule, []);
      
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
        const condition = trimmed.replace(/^(When|Given|And)\s+/, '');
        if (condition && !condition.includes(':')) {
          conditions.push(parseCondition(condition));
          extractVariables(condition, variables);
        }
      } else if (trimmed.startsWith('Or') && inConditions) {
        const condition = trimmed.replace(/^Or\s+/, '');
        if (condition && !condition.includes(':')) {
          conditions.push(parseCondition(condition));
          extractVariables(condition, variables);
        }
      } else if (trimmed.match(/^(Then|And)\s+/)) {
        inConditions = false;
        const outcome = trimmed.replace(/^(Then|And)\s+/, '');
        outcomes.push(parseOutcome(outcome));
      } else if (trimmed.startsWith('-')) {
        // List item
        const item = trimmed.substring(1).trim();
        if (inConditions) {
          conditions.push(parseCondition(item));
          extractVariables(item, variables);
        }
      }
    }
  });
  
  // Save final scenario
  if (currentScenario) {
    scenarios.push({
      name: currentScenario,
      conditions: conditions,
      outcomes: outcomes
    });
  }
  
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
  
  // Generate variable definitions
  output += generateVariableDefinitions(variables);
  output += '\n';
  
  // Generate schedule parameters if any
  if (schedules.size > 0) {
    output += generateScheduleParameters(schedules);
    output += '\n';
  }
  
  // Generate scenario code
  scenarios.forEach(scenario => {
    output += generateScenarioCode(
      scenario.name, 
      scenario.conditions, 
      scenario.outcomes, 
      variables, 
      schedules
    );
  });
  
  return output;
}

// Validate generated OpenFisca code
function validateOpenFiscaCode(code) {
  const issues = [];
  const lines = code.split('\n');
  
  // Track defined classes and variables
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
    
    // Check for malformed operators
    if (trimmed.match(/\s+([<>=]+)\s+\s+/)) {
      issues.push({
        line: lineNum,
        message: 'Extra spaces around operator',
        severity: 'warning'
      });
    }
  });
  
  // Check for referenced but undefined variables
  referencedVariables.forEach(varName => {
    if (!definedVariables.has(varName) && 
        !['income'].includes(varName)) { // income is commonly assumed to exist
      issues.push({
        message: `Variable '${varName}' is referenced but not defined`,
        severity: 'warning'
      });
    }
  });
  
  return issues;
}

// Export functions for use in editor.js
window.compileToOpenFisca = compileToOpenFisca;
window.validateOpenFiscaCode = validateOpenFiscaCode;
