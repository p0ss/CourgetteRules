// Courgette Validation Web Worker
// Provides real-time syntax checking and validation for the editor

/**
 * Validation result structure
 * @typedef {Object} ValidationError
 * @property {number} line - Line number (1-indexed)
 * @property {number} column - Column number (1-indexed)
 * @property {string} message - Error message
 * @property {string} severity - 'error' | 'warning' | 'info'
 * @property {number} startOffset - Character offset in text
 * @property {number} endOffset - Character offset in text
 */

/**
 * Main validation function
 * @param {string} text - Courgette source text
 * @returns {ValidationError[]} Array of validation errors
 */
function validateCourgette(text) {
    const errors = [];
    const lines = text.split('\n');
    
    // Track context
    let currentBlock = null; // 'scenario', 'definition', 'schedule'
    let blockStartLine = -1;
    let hasConditions = false;
    let hasOutcomes = false;
    let expectingListItems = false;
    let indentLevel = 0;
    
    // Track definitions and schedules for reference checking
    const definitions = new Set();
    const schedules = new Set();
    const variables = new Set();
    
    // First pass: collect definitions and schedules
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('Definition:')) {
            const name = trimmed.substring(11).trim();
            if (name) definitions.add(name);
        } else if (trimmed.startsWith('Schedule:')) {
            const name = trimmed.substring(9).trim();
            if (name) schedules.add(name);
        }
    });
    
    // Second pass: detailed validation
    lines.forEach((line, idx) => {
        const lineNum = idx + 1;
        const trimmed = line.trim();
        const leadingSpaces = line.match(/^(\s*)/)[1].length;
        
        // Check for tabs (Australian style guide prefers spaces)
        if (line.includes('\t')) {
            errors.push({
                line: lineNum,
                column: line.indexOf('\t') + 1,
                message: 'Use spaces instead of tabs for indentation',
                severity: 'warning',
                startOffset: getOffset(lines, idx, line.indexOf('\t')),
                endOffset: getOffset(lines, idx, line.indexOf('\t') + 1)
            });
        }
        
        // Empty line handling
        if (!trimmed) {
            expectingListItems = false;
            return;
        }
        
        // Block headers
        if (trimmed.startsWith('Scenario:')) {
            // Check previous scenario
            if (currentBlock === 'scenario' && !hasOutcomes) {
                errors.push({
                    line: blockStartLine,
                    column: 1,
                    message: 'Scenario missing outcome statements (Then...)',
                    severity: 'error',
                    startOffset: getOffset(lines, blockStartLine - 1, 0),
                    endOffset: getOffset(lines, blockStartLine - 1, lines[blockStartLine - 1].length)
                });
            }
            
            currentBlock = 'scenario';
            blockStartLine = lineNum;
            hasConditions = false;
            hasOutcomes = false;
            
            const name = trimmed.substring(9).trim();
            if (!name) {
                errors.push({
                    line: lineNum,
                    column: 10,
                    message: 'Scenario name is required',
                    severity: 'error',
                    startOffset: getOffset(lines, idx, 9),
                    endOffset: getOffset(lines, idx, line.length)
                });
            } else if (!/^[A-Z]/.test(name)) {
                errors.push({
                    line: lineNum,
                    column: 10,
                    message: 'Scenario names should start with a capital letter',
                    severity: 'warning',
                    startOffset: getOffset(lines, idx, 9),
                    endOffset: getOffset(lines, idx, 9 + name.length)
                });
            }
        }
        else if (trimmed.startsWith('Definition:')) {
            currentBlock = 'definition';
            blockStartLine = lineNum;
            
            const name = trimmed.substring(11).trim();
            if (!name) {
                errors.push({
                    line: lineNum,
                    column: 12,
                    message: 'Definition term is required',
                    severity: 'error',
                    startOffset: getOffset(lines, idx, 11),
                    endOffset: getOffset(lines, idx, line.length)
                });
            }
        }
        else if (trimmed.startsWith('Schedule:')) {
            currentBlock = 'schedule';
            blockStartLine = lineNum;
            
            const name = trimmed.substring(9).trim();
            if (!name) {
                errors.push({
                    line: lineNum,
                    column: 10,
                    message: 'Schedule name is required',
                    severity: 'error',
                    startOffset: getOffset(lines, idx, 9),
                    endOffset: getOffset(lines, idx, line.length)
                });
            }
        }
        
        // Scenario validation
        else if (currentBlock === 'scenario') {
            // Condition keywords
            if (trimmed.match(/^(When|Given|And|Or)\s+/)) {
                const [keyword, ...rest] = trimmed.split(/\s+/);
                const condition = rest.join(' ');
                
                // Check for group starters
                if (condition.endsWith('these are true:') || condition.endsWith('the following:')) {
                    expectingListItems = true;
                    indentLevel = leadingSpaces;
                } else {
                    // Validate condition syntax
                    validateCondition(condition, lineNum, keyword.length + 1, errors, lines, idx);
                    hasConditions = true;
                    
                    // Extract variables
                    extractVariables(condition, variables);
                }
                
                // Check keyword usage
                if (keyword === 'Or' && !hasConditions) {
                    errors.push({
                        line: lineNum,
                        column: 1,
                        message: 'Or cannot be used before any conditions',
                        severity: 'error',
                        startOffset: getOffset(lines, idx, 0),
                        endOffset: getOffset(lines, idx, keyword.length)
                    });
                }
            }
            
            // List items
            else if (trimmed.startsWith('- ')) {
                if (!expectingListItems) {
                    errors.push({
                        line: lineNum,
                        column: leadingSpaces + 1,
                        message: 'List items must follow a group declaration (e.g., "any of these are true:")',
                        severity: 'error',
                        startOffset: getOffset(lines, idx, leadingSpaces),
                        endOffset: getOffset(lines, idx, leadingSpaces + 2)
                    });
                }
                
                const condition = trimmed.substring(2).trim();
                validateCondition(condition, lineNum, leadingSpaces + 3, errors, lines, idx);
                extractVariables(condition, variables);
            }
            
            // Outcome statements
            else if (trimmed.match(/^(Then|And)\s+/)) {
                if (!hasConditions) {
                    errors.push({
                        line: lineNum,
                        column: 1,
                        message: 'Outcomes (Then) must follow conditions (When/Given)',
                        severity: 'error',
                        startOffset: getOffset(lines, idx, 0),
                        endOffset: getOffset(lines, idx, 4)
                    });
                }
                
                hasOutcomes = true;
                expectingListItems = false;
                
                const outcome = trimmed.replace(/^(Then|And)\s+/, '');
                validateOutcome(outcome, lineNum, trimmed.indexOf(outcome) + 1, errors, lines, idx, schedules);
            }
            
            // Invalid content in scenario
            else if (!trimmed.startsWith('#')) {  // Allow comments
                errors.push({
                    line: lineNum,
                    column: 1,
                    message: 'Expected When, Given, And, Or, Then, or list item (-)',
                    severity: 'error',
                    startOffset: getOffset(lines, idx, 0),
                    endOffset: getOffset(lines, idx, trimmed.length)
                });
            }
        }
        
        // Schedule validation
        else if (currentBlock === 'schedule') {
            if (trimmed.startsWith('When ')) {
                const match = trimmed.match(/^When\s+(.+?):\s*\$?([\d,._]+)(?:\s+per\s+(\w+))?$/);
                if (!match) {
                    errors.push({
                        line: lineNum,
                        column: 1,
                        message: 'Invalid schedule entry format. Expected: "When [condition]: $[amount] per [period]"',
                        severity: 'error',
                        startOffset: getOffset(lines, idx, 0),
                        endOffset: getOffset(lines, idx, trimmed.length)
                    });
                } else {
                    const [, condition, amount, period] = match;
                    
                    // Validate amount
                    if (!/^\d+(?:[,._]\d+)*(?:\.\d+)?$/.test(amount)) {
                        const amountStart = trimmed.indexOf(amount);
                        errors.push({
                            line: lineNum,
                            column: amountStart + 1,
                            message: 'Invalid amount format',
                            severity: 'error',
                            startOffset: getOffset(lines, idx, amountStart),
                            endOffset: getOffset(lines, idx, amountStart + amount.length)
                        });
                    }
                    
                    // Check period
                    if (period && !['fortnight', 'week', 'month', 'year'].includes(period.toLowerCase())) {
                        errors.push({
                            line: lineNum,
                            column: trimmed.lastIndexOf(period) + 1,
                            message: `Unknown period '${period}'. Use: fortnight, week, month, or year`,
                            severity: 'warning',
                            startOffset: getOffset(lines, idx, trimmed.lastIndexOf(period)),
                            endOffset: getOffset(lines, idx, trimmed.lastIndexOf(period) + period.length)
                        });
                    }
                }
            } else if (!trimmed.startsWith('Note:') && !trimmed.startsWith('#')) {
                errors.push({
                    line: lineNum,
                    column: 1,
                    message: 'Expected schedule entry starting with "When" or "Note:"',
                    severity: 'error',
                    startOffset: getOffset(lines, idx, 0),
                    endOffset: getOffset(lines, idx, trimmed.length)
                });
            }
        }
    });
    
    // Final checks
    if (currentBlock === 'scenario' && !hasOutcomes) {
        errors.push({
            line: blockStartLine,
            column: 1,
            message: 'Scenario missing outcome statements (Then...)',
            severity: 'error',
            startOffset: getOffset(lines, blockStartLine - 1, 0),
            endOffset: getOffset(lines, blockStartLine - 1, lines[blockStartLine - 1].length)
        });
    }
    
    return errors;
}

/**
 * Validate a condition expression
 */
function validateCondition(condition, lineNum, columnOffset, errors, lines, lineIdx) {
    // Check for natural language operators
    const naturalOperators = [
        'is less than', 'is greater than', 'is at least', 'is at most',
        'is more than', 'is no more than', 'is no less than', 
        'is equal to', 'is not equal to', 'is not', 'is'
    ];
    
    // Check for code-style operators
    const codeOperators = ['==', '!=', '<=', '>=', '<', '>'];
    
    // Check for special constructs
    const specialConstructs = ['between', 'and'];
    
    const hasNaturalOp = naturalOperators.some(op => 
        condition.toLowerCase().includes(op)
    );
    
    const hasCodeOp = codeOperators.some(op => {
        const regex = new RegExp(`\\s*${op.replace(/[<>=]/g, '\\$&')}\\s*`);
        return regex.test(condition);
    });
    
    const hasBetween = /\bbetween\b/i.test(condition);
    
    // Allow standalone boolean variables
    const isStandaloneBoolean = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(condition.trim());
    
    if (!hasNaturalOp && !hasCodeOp && !hasBetween && !isStandaloneBoolean && condition !== '') {
        errors.push({
            line: lineNum,
            column: columnOffset,
            message: 'Condition missing comparison (e.g., "is less than", "<", "between")',
            severity: 'error',
            startOffset: getOffset(lines, lineIdx, columnOffset - 1),
            endOffset: getOffset(lines, lineIdx, columnOffset - 1 + condition.length)
        });
        return;
    }
    
    // Validate between syntax
    if (hasBetween) {
        const betweenMatch = condition.match(/(\w+)\s+between\s+(.+?)\s+and\s+(.+)/i);
        if (!betweenMatch) {
            const betweenPos = condition.toLowerCase().indexOf('between');
            errors.push({
                line: lineNum,
                column: columnOffset + betweenPos,
                message: 'Invalid "between" syntax. Use: variable between X and Y',
                severity: 'error',
                startOffset: getOffset(lines, lineIdx, columnOffset - 1 + betweenPos),
                endOffset: getOffset(lines, lineIdx, columnOffset - 1 + betweenPos + 7)
            });
        }
    }
    
    // Check for unmatched quotes
    const quotes = condition.match(/["']/g) || [];
    if (quotes.length % 2 !== 0) {
        errors.push({
            line: lineNum,
            column: columnOffset,
            message: 'Unmatched quotes in condition',
            severity: 'error',
            startOffset: getOffset(lines, lineIdx, columnOffset - 1),
            endOffset: getOffset(lines, lineIdx, columnOffset - 1 + condition.length)
        });
    }
    
    // Validate boolean values
    const boolMatch = condition.match(/\b(true|false|yes|no|eligible)\b/gi);
    if (boolMatch) {
        boolMatch.forEach(bool => {
            if (!['true', 'false', 'yes', 'no', 'eligible'].includes(bool.toLowerCase())) {
                const boolPos = condition.indexOf(bool);
                errors.push({
                    line: lineNum,
                    column: columnOffset + boolPos,
                    message: `Invalid boolean value: ${bool}`,
                    severity: 'warning',
                    startOffset: getOffset(lines, lineIdx, columnOffset - 1 + boolPos),
                    endOffset: getOffset(lines, lineIdx, columnOffset - 1 + boolPos + bool.length)
                });
            }
        });
    }
    
    // Validate money values have $ symbol
    const moneyMatch = condition.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b/g);
    if (moneyMatch) {
        moneyMatch.forEach(amount => {
            if (parseFloat(amount.replace(/,/g, '')) >= 1000) {
                const amountPos = condition.indexOf(amount);
                const hasDollar = condition.substring(Math.max(0, amountPos - 2), amountPos).includes('$');
                if (!hasDollar) {
                    errors.push({
                        line: lineNum,
                        column: columnOffset + amountPos,
                        message: `Consider using $ for monetary amounts: $${amount}`,
                        severity: 'warning',
                        startOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos),
                        endOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos + amount.length)
                    });
                }
            }
        });
    }
}

/**
 * Validate an outcome expression
 */
function validateOutcome(outcome, lineNum, columnOffset, errors, lines, lineIdx, schedules) {
    // Check for eligibility outcomes - support natural language
    const eligibilityPatterns = [
        /\w+\s*=\s*true/i,
        /\w+\s+is\s+eligible/i,
        /\w+\s+is\s+yes/i,
        /\w+\s+is\s+true/i
    ];
    
    const hasEligibility = eligibilityPatterns.some(pattern => pattern.test(outcome));
    if (hasEligibility) return;
    
    // Check for payment outcomes
    if (outcome.match(/payment\s+is\s+\$?[\d,._]+/i)) {
        const amountMatch = outcome.match(/\$?([\d,._]+)/);
        if (amountMatch) {
            const amount = amountMatch[1];
            if (!/^\d+(?:[,._]\d+)*(?:\.\d+)?$/.test(amount)) {
                const amountPos = outcome.indexOf(amount);
                errors.push({
                    line: lineNum,
                    column: columnOffset + amountPos,
                    message: 'Invalid payment amount format',
                    severity: 'error',
                    startOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos),
                    endOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos + amount.length)
                });
            }
        }
        return;
    }
    
    // Check for base rate outcomes
    if (outcome.match(/base\s+rate\s+is\s+\$?[\d,._]+/i)) {
        const amountMatch = outcome.match(/\$?([\d,._]+)/);
        if (amountMatch) {
            const amount = amountMatch[1];
            if (!/^\d+(?:[,._]\d+)*(?:\.\d+)?$/.test(amount)) {
                const amountPos = outcome.indexOf(amount);
                errors.push({
                    line: lineNum,
                    column: columnOffset + amountPos,
                    message: 'Invalid base rate amount format',
                    severity: 'error',
                    startOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos),
                    endOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos + amount.length)
                });
            }
        }
        return;
    }
    
    // Check for schedule references
    if (outcome.match(/rate\s+is\s+determined\s+by\s+(.+)/i)) {
        const scheduleMatch = outcome.match(/rate\s+is\s+determined\s+by\s+(.+)/i);
        const scheduleName = scheduleMatch[1].trim();
        
        if (!schedules.has(scheduleName)) {
            const schedulePos = outcome.indexOf(scheduleName);
            errors.push({
                line: lineNum,
                column: columnOffset + schedulePos,
                message: `Schedule '${scheduleName}' not defined`,
                severity: 'error',
                startOffset: getOffset(lines, lineIdx, columnOffset - 1 + schedulePos),
                endOffset: getOffset(lines, lineIdx, columnOffset - 1 + schedulePos + scheduleName.length)
            });
        }
        return;
    }
    
    // Check for reduction rules
    if (outcome.match(/(?:payment\s+)?reduces?\s+by\s+\d+\s+cents?\s+per\s+dollar/i)) {
        const reductionMatch = outcome.match(/reduces?\s+by\s+(\d+)\s+cents?\s+per\s+dollar\s+over\s+\$?([\d,._]+)/i);
        if (reductionMatch) {
            const [, cents, threshold] = reductionMatch;
            
            // Validate cents
            if (parseInt(cents) > 100) {
                errors.push({
                    line: lineNum,
                    column: columnOffset + outcome.indexOf(cents),
                    message: 'Reduction rate cannot exceed 100 cents per dollar',
                    severity: 'warning',
                    startOffset: getOffset(lines, lineIdx, columnOffset - 1 + outcome.indexOf(cents)),
                    endOffset: getOffset(lines, lineIdx, columnOffset - 1 + outcome.indexOf(cents) + cents.length)
                });
            }
            
            // Validate threshold format
            if (!/^\d+(?:[,._]\d+)*(?:\.\d+)?$/.test(threshold)) {
                const thresholdPos = outcome.lastIndexOf(threshold);
                errors.push({
                    line: lineNum,
                    column: columnOffset + thresholdPos,
                    message: 'Invalid threshold amount format',
                    severity: 'error',
                    startOffset: getOffset(lines, lineIdx, columnOffset - 1 + thresholdPos),
                    endOffset: getOffset(lines, lineIdx, columnOffset - 1 + thresholdPos + threshold.length)
                });
            }
        }
        return;
    }
    
    // Check for cutout/threshold rules
    if (outcome.match(/(?:payment\s+)?(?:cuts?\s*out|ceases?)\s+at\s+\$?([\d,._]+)/i)) {
        const cutoutMatch = outcome.match(/\$?([\d,._]+)/);
        if (cutoutMatch) {
            const amount = cutoutMatch[1];
            if (!/^\d+(?:[,._]\d+)*(?:\.\d+)?$/.test(amount)) {
                const amountPos = outcome.indexOf(amount);
                errors.push({
                    line: lineNum,
                    column: columnOffset + amountPos,
                    message: 'Invalid cutout amount format',
                    severity: 'error',
                    startOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos),
                    endOffset: getOffset(lines, lineIdx, columnOffset - 1 + amountPos + amount.length)
                });
            }
        }
        return;
    }
    
    // Unknown outcome format
    errors.push({
        line: lineNum,
        column: columnOffset,
        message: 'Unrecognised outcome format. Expected: eligibility (is eligible), payment amount, schedule reference, or reduction rule',
        severity: 'warning',
        startOffset: getOffset(lines, lineIdx, columnOffset - 1),
        endOffset: getOffset(lines, lineIdx, columnOffset - 1 + outcome.length)
    });
}

/**
 * Extract variable names from a condition
 */
function extractVariables(condition, variables) {
    // Simple pattern to extract potential variable names
    const varPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;
    
    while ((match = varPattern.exec(condition)) !== null) {
        const varName = match[1];
        // Exclude keywords and boolean values
        const excludeWords = [
            'and', 'or', 'not', 'between', 'is', 'true', 'false', 'yes', 'no', 'eligible', 'less', 'greater', 'than', 'at', 'least', 'most', 'more', 'equal', 'to'
        ];
        
        if (!excludeWords.includes(varName.toLowerCase())) {
            variables.add(varName);
        }
    }
}

/**
 * Calculate character offset in the full text
 */
function getOffset(lines, lineIdx, column) {
    let offset = 0;
    for (let i = 0; i < lineIdx; i++) {
        offset += lines[i].length + 1; // +1 for newline
    }
    return offset + column;
}

// Web Worker message handling
self.addEventListener('message', (event) => {
    const { text } = event.data;
    const errors = validateCourgette(text);
    self.postMessage({ errors });
});
