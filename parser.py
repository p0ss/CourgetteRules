"""
Courgette Parser - Enhanced implementation for Australian Rules as Code
Converts plain English eligibility rules to OpenFisca Python code
"""

from __future__ import annotations

import re
import textwrap
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union, Set
from datetime import datetime

from lark import Lark, Transformer, v_args

# ---------------------------------------------------------------------------
#  1. Enhanced AST with Australian terminology
# ---------------------------------------------------------------------------

@dataclass
class Expression:
    """Base class for all expressions in Courgette syntax"""
    source_line: Optional[int] = None

@dataclass
class Variable(Expression):
    name: str
    definition: Optional["Definition"] = None
    
    def to_python(self) -> str:
        """Convert to Python variable reference"""
        return f"person('{self.name}', period)"

@dataclass
class Number(Expression):
    value: float
    
    def to_python(self) -> str:
        return str(self.value)

@dataclass
class String(Expression):
    value: str
    
    def to_python(self) -> str:
        return f"'{self.value}'"

@dataclass
class Boolean(Expression):
    value: bool
    
    def to_python(self) -> str:
        return "True" if self.value else "False"

@dataclass
class Calculation(Expression):
    calc_type: str
    parameters: Dict[str, Any]
    
    def to_python(self) -> str:
        if self.calc_type == "fixed_payment":
            return f"{self.parameters['amount']}"
        elif self.calc_type == "schedule_lookup":
            return f"parameters.{self.parameters['schedule'].lower().replace(' ', '_')}[period]"
        return "0"

@dataclass
class Comparison(Expression):
    left: Expression
    operator: str
    right: Expression
    
    def to_python(self) -> str:
        return f"({self.left.to_python()} {self.operator} {self.right.to_python()})"

@dataclass
class LogicalExpression(Expression):
    operator: str  # "and", "or", "not"
    operands: List[Expression]
    
    def to_python(self) -> str:
        if self.operator == "not":
            return f"not ({self.operands[0].to_python()})"
        op_str = f" {self.operator} "
        return f"({op_str.join(op.to_python() for op in self.operands)})"

@dataclass
class Reference:
    ref_type: str  # "section", "schedule", "definition"
    target: str
    location: Optional[str] = None

@dataclass
class Definition:
    term: str
    definition_type: str
    content: Union[str, Expression, Reference]
    conditions: Optional[List["Rule"]] = None
    source: Optional[Reference] = None
    
    def to_openfisca_variable(self) -> str:
        """Generate OpenFisca variable definition"""
        class_name = self.term.lower().replace(' ', '_')
        return f"""
class {class_name}(Variable):
    value_type = float
    entity = Person
    definition_period = MONTH
    label = "{self.term}"
    reference = "{self.source.location if self.source else ''}"
    
    def formula(person, period, parameters):
        # {self.content if isinstance(self.content, str) else 'Complex calculation'}
        return 0  # TODO: Implement calculation
"""

@dataclass
class Schedule:
    name: str
    schedule_type: str
    entries: List[Dict[str, Any]]
    notes: Optional[List[str]] = None
    
    def to_openfisca_parameter(self) -> str:
        """Generate OpenFisca parameter definition"""
        param_name = self.name.lower().replace(' ', '_')
        yaml_content = f"{param_name}:\n"
        yaml_content += "  description: " + self.name + "\n"
        yaml_content += "  values:\n"
        
        for entry in self.entries:
            # Convert conditions to dates/brackets for parameters
            yaml_content += f"    - condition: {entry['condition']}\n"
            yaml_content += f"      value: {entry['amount']}\n"
        
        return yaml_content

@dataclass
class Rule:
    text: str
    parsed: Optional[Expression] = None
    references: List[Reference] = field(default_factory=list)

@dataclass
class RuleGroup:
    rules: List[Union["Rule", "RuleGroup"]]
    operator: str = "all of"  # "all of", "any of", "none of"
    
    def to_python(self) -> str:
        """Convert rule group to Python boolean expression"""
        if self.operator == "all of":
            op = " and "
        elif self.operator == "any of":
            op = " or "
        else:  # "none of"
            return f"not ({' or '.join(r.to_python() for r in self.rules)})"
        
        return f"({op.join(r.to_python() for r in self.rules)})"

@dataclass
class Scenario:
    name: str
    conditions: RuleGroup
    outcomes: List[Rule]
    definitions: Dict[str, Definition] = field(default_factory=dict)
    schedules: Dict[str, Schedule] = field(default_factory=dict)
    
    def to_openfisca_class(self) -> str:
        """Generate complete OpenFisca class for this scenario"""
        class_name = self.name.lower().replace(' ', '_')
        
        # Eligibility variable
        code = f'''
class {class_name}_eligible(Variable):
    """Eligibility for {self.name}"""
    value_type = bool
    entity = Person
    definition_period = MONTH
    label = "{self.name} eligibility"
    documentation = """
    {self._generate_documentation()}
    """
    
    def formula(person, period, parameters):
        # Get all required variables
{self._generate_variable_declarations()}
        
        # Check eligibility conditions
        return {self._generate_conditions()}
'''
        
        # Payment amount variable if applicable
        payment_rules = [r for r in self.outcomes if 'payment' in r.text.lower()]
        if payment_rules:
            code += self._generate_payment_variable()
        
        return code
    
    def _generate_documentation(self) -> str:
        """Generate documentation from the scenario rules"""
        doc = f"Scenario: {self.name}\n\n"
        doc += "Conditions:\n"
        doc += self._format_conditions(self.conditions, indent=2)
        doc += "\nOutcomes:\n"
        for outcome in self.outcomes:
            doc += f"  - {outcome.text}\n"
        return doc
    
    def _format_conditions(self, conditions: RuleGroup, indent: int) -> str:
        """Format conditions for documentation"""
        result = ""
        prefix = " " * indent
        for rule in conditions.rules:
            if isinstance(rule, RuleGroup):
                result += f"{prefix}{rule.operator}:\n"
                result += self._format_conditions(rule, indent + 2)
            else:
                result += f"{prefix}- {rule.text}\n"
        return result
    
    def _generate_variable_declarations(self) -> str:
        """Generate variable declarations for formula"""
        variables = self._extract_variables()
        lines = []
        for var in sorted(variables):
            lines.append(f"        {var} = person('{var}', period)")
        return '\n'.join(lines)
    
    def _extract_variables(self) -> Set[str]:
        """Extract all variables used in conditions"""
        variables = set()
        
        def extract_from_expr(expr: Expression):
            if isinstance(expr, Variable):
                variables.add(expr.name)
            elif isinstance(expr, Comparison):
                extract_from_expr(expr.left)
                extract_from_expr(expr.right)
            elif isinstance(expr, LogicalExpression):
                for op in expr.operands:
                    extract_from_expr(op)
        
        def extract_from_rules(rules: List[Union[Rule, RuleGroup]]):
            for rule in rules:
                if isinstance(rule, Rule) and rule.parsed:
                    extract_from_expr(rule.parsed)
                elif isinstance(rule, RuleGroup):
                    extract_from_rules(rule.rules)
        
        extract_from_rules(self.conditions.rules)
        return variables
    
    def _generate_conditions(self) -> str:
        """Generate Python condition expression"""
        return self.conditions.to_python()
    
    def _generate_payment_variable(self) -> str:
        """Generate payment amount variable"""
        class_name = self.name.lower().replace(' ', '_')
        
        # Extract payment information
        payment_info = self._extract_payment_info()
        
        return f'''

class {class_name}_payment(Variable):
    """Payment amount for {self.name}"""
    value_type = float
    entity = Person
    definition_period = MONTH
    label = "{self.name} payment amount"
    
    def formula(person, period, parameters):
        eligible = person('{class_name}_eligible', period)
        
        if not eligible:
            return 0
        
        # Base payment calculation
        {payment_info}
'''
    
    def _extract_payment_info(self) -> str:
        """Extract payment calculation logic from outcomes"""
        for outcome in self.outcomes:
            if 'payment is' in outcome.text:
                # Extract amount
                match = re.search(r'\$?([\d,._]+)', outcome.text)
                if match:
                    amount = float(match.group(1).replace(',', '').replace('_', ''))
                    return f"return {amount}"
            elif 'rate is determined by' in outcome.text:
                # Schedule lookup
                match = re.search(r'determined by (.+)', outcome.text)
                if match:
                    schedule = match.group(1).strip()
                    param_name = schedule.lower().replace(' ', '_')
                    return f"return parameters.{param_name}[period]"
        
        return "return 0  # TODO: Implement payment calculation"

# ---------------------------------------------------------------------------
#  2. Enhanced Lark Grammar for Courgette
# ---------------------------------------------------------------------------

_COURGETTE_GRAMMAR = r"""
?start: expr

?expr: or_expr

?or_expr: and_expr ("or" and_expr)*   -> or_chain
?and_expr: not_expr ("and" not_expr)*  -> and_chain
?not_expr: "not" atom                  -> negate
        | atom

?atom: comparison
     | "(" expr ")"

comparison: var comp_op value                 -> simple_comp
          | var "between" value "and" value   -> between_comp
          | var "is" "not"? value            -> is_comp

var: IDENTIFIER                              -> var

comp_op: "==" | "!=" | "<=" | ">=" | "<" | ">"

value: NUMBER      -> num
     | STRING      -> string
     | BOOL        -> bool
     | IDENTIFIER  -> var_value

BOOL: "true"i | "false"i
IDENTIFIER: /[a-zA-Z_][a-zA-Z0-9_]*/
NUMBER: /[0-9]+(?:_[0-9]+)*(?:\.[0-9]+)?/
STRING: /"[^"]*"/ | /'[^']*'/

%import common.WS
%ignore WS
"""

@v_args(inline=True)
class CourgetteTransformer(Transformer):
    def var(self, name): 
        return Variable(str(name))
    
    def var_value(self, name):
        # Could be a variable reference or enum value
        return Variable(str(name))
    
    def num(self, value): 
        return Number(float(str(value).replace("_", "")))
    
    def string(self, value): 
        # Remove quotes
        s = str(value)
        return String(s[1:-1] if s.startswith(('"', "'")) else s)
    
    def bool(self, value): 
        return Boolean(str(value).lower() == "true")
    
    def simple_comp(self, left, op, right): 
        return Comparison(left, str(op), right)
    
    def is_comp(self, left, not_token, right):
        op = "!=" if not_token else "=="
        return Comparison(left, op, right)
    
    def between_comp(self, var, low, high):
        return LogicalExpression("and", [
            Comparison(var, ">=", low), 
            Comparison(var, "<=", high)
        ])
    
    def and_chain(self, first, *rest):
        return LogicalExpression("and", [first, *rest]) if rest else first
    
    def or_chain(self, first, *rest):
        return LogicalExpression("or", [first, *rest]) if rest else first
    
    def negate(self, expr):
        return LogicalExpression("not", [expr])

# Create parser instance
_COURGETTE_PARSER = Lark(_COURGETTE_GRAMMAR, parser="lalr", transformer=CourgetteTransformer())

# ---------------------------------------------------------------------------
#  3. Enhanced Courgette Parser
# ---------------------------------------------------------------------------

class CourgetteParser:
    """Enhanced parser for Courgette syntax with Australian terminology support"""
    
    # Outcome patterns
    _OUTCOME_PATTERNS = {
        'eligibility': re.compile(r"(?i)^(.+?)\s*(?:=|is)\s*(?:true|eligible)$"),
        'payment': re.compile(r"(?i)^payment\s+is\s+\$?([\d,._]+)(?:\s+per\s+(\w+))?"),
        'base_rate': re.compile(r"(?i)^base rate is\s+\$?([\d,._]+)"),
        'schedule': re.compile(r"(?i)rate is determined by (.+)"),
        'reduction': re.compile(r"(?i)(?:payment\s+)?reduces? by ([\d.]+) cents per dollar over \$?([\d,._]+)"),
        'threshold': re.compile(r"(?i)cut[- ]?out at \$?([\d,._]+)"),
    }
    
    # Schedule entry pattern
    _SCHEDULE_PATTERN = re.compile(
        r"^When (.+?):\s*\$?([\d,._]+)(?:\s+per\s+(\w+))?",
        re.IGNORECASE
    )
    
    def parse(self, text: str) -> Tuple[List[Scenario], Dict[str, Definition], Dict[str, Schedule]]:
        """Parse Courgette text into AST"""
        definitions: Dict[str, Definition] = {}
        schedules: Dict[str, Schedule] = {}
        scenarios: List[Scenario] = []
        
        lines = [line.rstrip('\n') for line in text.strip().split('\n')]
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            if line.startswith("Scenario:"):
                scenario, i = self._parse_scenario(lines, i, definitions, schedules)
                scenarios.append(scenario)
            elif line.startswith("Definition:"):
                definition, i = self._parse_definition(lines, i)
                definitions[definition.term] = definition
            elif line.startswith("Schedule:"):
                schedule, i = self._parse_schedule(lines, i)
                schedules[schedule.name] = schedule
            else:
                i += 1
        
        return scenarios, definitions, schedules
    
    def _parse_definition(self, lines: List[str], start_idx: int) -> Tuple[Definition, int]:
        """Parse a Definition block"""
        term = lines[start_idx].split(":", 1)[1].strip()
        idx = start_idx + 1
        content_lines = []
        
        while idx < len(lines) and lines[idx].strip():
            if lines[idx].startswith(("Scenario:", "Schedule:", "Definition:")):
                break
            content_lines.append(lines[idx].strip())
            idx += 1
        
        content = " ".join(content_lines)
        
        # Try to parse as expression
        try:
            parsed_content = _COURGETTE_PARSER.parse(content)
            return Definition(term, "expression", parsed_content), idx
        except:
            # Fallback to text definition
            return Definition(term, "text", content), idx
    
    def _parse_schedule(self, lines: List[str], start_idx: int) -> Tuple[Schedule, int]:
        """Parse a Schedule block"""
        name = lines[start_idx].split(":", 1)[1].strip()
        idx = start_idx + 1
        entries = []
        notes = []
        
        while idx < len(lines) and lines[idx].strip():
            if lines[idx].startswith(("Scenario:", "Schedule:", "Definition:")):
                break
            
            line = lines[idx].strip()
            match = self._SCHEDULE_PATTERN.match(line)
            
            if match:
                condition, amount, period = match.groups()
                entries.append({
                    'condition': condition,
                    'amount': float(amount.replace(',', '').replace('_', '')),
                    'period': period or 'fortnight'
                })
            elif line.startswith("Note:"):
                notes.append(line[5:].strip())
            
            idx += 1
        
        return Schedule(name, "rates", entries, notes if notes else None), idx
    
    def _parse_scenario(self, lines: List[str], start_idx: int, 
                       definitions: Dict[str, Definition], 
                       schedules: Dict[str, Schedule]) -> Tuple[Scenario, int]:
        """Parse a Scenario block"""
        name = lines[start_idx].split(":", 1)[1].strip()
        idx = start_idx + 1
        
        # Stack for handling nested conditions
        condition_stack: List[RuleGroup] = [RuleGroup([], "all of")]
        outcomes: List[Rule] = []
        
        while idx < len(lines):
            line = lines[idx].rstrip()
            if not line or line.startswith("Scenario:"):
                break
            
            stripped = line.strip()
            
            # Handle conditions
            if stripped.startswith(("When", "Given", "And", "Or")):
                keyword, rest = stripped.split(" ", 1)
                
                # Check for group openers
                if rest.endswith("these are true:") or rest.endswith("the following:"):
                    operator = "any of" if "any of" in rest else "all of" if "all of" in rest else "none of"
                    condition_stack.append(RuleGroup([], operator))
                    idx += 1
                    continue
                
                # Parse condition
                try:
                    expr = _COURGETTE_PARSER.parse(rest)
                    rule = Rule(rest, expr)
                    
                    # Handle Or at same level
                    if keyword == "Or" and condition_stack[-1].rules:
                        # Create new "any of" group with previous and this condition
                        last_rule = condition_stack[-1].rules.pop()
                        or_group = RuleGroup([last_rule, rule], "any of")
                        condition_stack[-1].rules.append(or_group)
                    else:
                        condition_stack[-1].rules.append(rule)
                except Exception as e:
                    # Fallback for unparseable conditions
                    condition_stack[-1].rules.append(Rule(rest))
                
                idx += 1
                continue
            
            # Handle list items
            if stripped.startswith("- "):
                condition_text = stripped[2:].strip()
                try:
                    expr = _COURGETTE_PARSER.parse(condition_text)
                    condition_stack[-1].rules.append(Rule(condition_text, expr))
                except:
                    condition_stack[-1].rules.append(Rule(condition_text))
                idx += 1
                continue
            
            # Handle outcomes
            if stripped.startswith(("Then", "And")) and any(
                keyword in stripped.lower() 
                for keyword in ['payment', 'rate', 'eligible', '=', 'is']
            ):
                # Close any open condition groups
                while len(condition_stack) > 1:
                    group = condition_stack.pop()
                    condition_stack[-1].rules.append(group)
                
                # Parse outcome
                _, outcome_text = stripped.split(" ", 1)
                outcomes.append(self._parse_outcome(outcome_text))
                idx += 1
                continue
            
            idx += 1
        
        # Close remaining condition groups
        while len(condition_stack) > 1:
            group = condition_stack.pop()
            condition_stack[-1].rules.append(group)
        
        return Scenario(name, condition_stack[0], outcomes, definitions, schedules), idx
    
    def _parse_outcome(self, text: str) -> Rule:
        """Parse an outcome rule"""
        for outcome_type, pattern in self._OUTCOME_PATTERNS.items():
            match = pattern.match(text)
            if match:
                if outcome_type == 'eligibility':
                    benefit = match.group(1).strip()
                    return Rule(text, parsed={
                        'type': 'eligibility',
                        'benefit': benefit,
                        'variable': benefit.lower().replace(' ', '_'),
                        'value': True
                    })
                elif outcome_type == 'payment':
                    amount, period = match.groups()
                    return Rule(text, Calculation('fixed_payment', {
                        'amount': float(amount.replace(',', '').replace('_', '')),
                        'period': period or 'fortnight'
                    }))
                elif outcome_type == 'base_rate':
                    amount = match.group(1)
                    return Rule(text, Calculation('base_rate', {
                        'amount': float(amount.replace(',', '').replace('_', ''))
                    }))
                elif outcome_type == 'schedule':
                    schedule_name = match.group(1).strip()
                    return Rule(text, Calculation('schedule_lookup', {
                        'schedule': schedule_name
                    }))
                elif outcome_type == 'reduction':
                    cents, threshold = match.groups()
                    return Rule(text, Calculation('reduction', {
                        'rate': float(cents) / 100,
                        'threshold': float(threshold.replace(',', '').replace('_', ''))
                    }))
                elif outcome_type == 'threshold':
                    cutout = match.group(1)
                    return Rule(text, Calculation('threshold', {
                        'cutout': float(cutout.replace(',', '').replace('_', ''))
                    }))
        
        # Fallback for unrecognised outcomes
        return Rule(text)

# ---------------------------------------------------------------------------
#  4. OpenFisca Code Generator
# ---------------------------------------------------------------------------

class OpenFiscaGenerator:
    """Generate OpenFisca Python code from Courgette AST"""
    
    def __init__(self):
        self.variable_types: Dict[str, str] = {}
        self.generated_variables: Set[str] = set()
    
    def generate(self, scenarios: List[Scenario], 
                definitions: Dict[str, Definition], 
                schedules: Dict[str, Schedule]) -> str:
        """Generate complete OpenFisca module"""
        
        # Header
        code = f'''"""
Generated OpenFisca implementation from Courgette rules
Generated: {datetime.now().strftime("%d %B %Y")}

This file implements eligibility rules and payment calculations
for Australian social security benefits.
"""

from openfisca_core.model_api import *
from openfisca_core.periods import MONTH, YEAR, ETERNITY, period


'''
        
        # Generate entity definitions
        code += self._generate_entities()
        
        # Generate variable definitions from AST analysis
        code += self._generate_variable_definitions(scenarios, definitions)
        
        # Generate definition variables
        for definition in definitions.values():
            code += definition.to_openfisca_variable()
        
        # Generate scenario implementations
        for scenario in scenarios:
            code += scenario.to_openfisca_class()
        
        # Generate parameter file content separately
        param_code = self._generate_parameters(schedules)
        
        return code, param_code
    
    def _generate_entities(self) -> str:
        """Generate entity definitions"""
        return '''
class Person(Entity):
    """An individual person"""
    plural = "persons"
    label = "Person"
    doc = "An individual. The minimal legal entity on which a rule might be applied."


class Family(Entity):
    """A family unit for benefit calculations"""
    plural = "families"
    label = "Family"
    doc = "A family unit as defined for social security purposes"
    roles = [
        {
            "key": "parent",
            "plural": "parents",
            "label": "Parent",
            "max": 2,
        },
        {
            "key": "child",
            "plural": "children", 
            "label": "Child",
        },
    ]


'''
    
    def _generate_variable_definitions(self, scenarios: List[Scenario], 
                                     definitions: Dict[str, Definition]) -> str:
        """Generate variable definitions based on usage analysis"""
        variables = self._collect_all_variables(scenarios)
        code = "# Base Variables\n\n"
        
        for var_name in sorted(variables):
            if var_name not in self.generated_variables:
                code += self._generate_single_variable(var_name)
                self.generated_variables.add(var_name)
        
        return code + "\n"
    
    def _collect_all_variables(self, scenarios: List[Scenario]) -> Set[str]:
        """Collect all variables used across scenarios"""
        variables = set()
        
        for scenario in scenarios:
            variables.update(scenario._extract_variables())
        
        return variables
    
    def _generate_single_variable(self, var_name: str) -> str:
        """Generate a single variable definition"""
        # Infer type from name patterns
        var_type = self._infer_variable_type(var_name)
        
        # Special handling for common Australian benefit variables
        if var_name in ['age', 'income', 'assets']:
            entity = "Person"
        elif 'family' in var_name or 'household' in var_name:
            entity = "Family"
        else:
            entity = "Person"
        
        label = var_name.replace('_', ' ').title()
        
        return f'''
class {var_name}(Variable):
    value_type = {var_type}
    entity = {entity}
    definition_period = MONTH
    label = "{label}"
    

'''
    
    def _infer_variable_type(self, var_name: str) -> str:
        """Infer variable type from name"""
        # Boolean indicators
        if any(prefix in var_name for prefix in ['is_', 'has_', 'eligible']):
            return "bool"
        
        # String types
        if any(suffix in var_name for suffix in ['_status', '_type', '_category']):
            return "str"
        
        # Enums for employment status
        if var_name == "employment_status":
            return "str"  # Could be enhanced to Enum
        
        # Numeric types
        if any(keyword in var_name for keyword in ['age', 'income', 'amount', 'rate', 'payment', 'assets']):
            return "float"
        
        # Default to float for unknowns
        return "float"
    
    def _generate_parameters(self, schedules: Dict[str, Schedule]) -> str:
        """Generate parameter YAML content"""
        yaml = """# OpenFisca Parameters
# Generated from Courgette schedules

"""
        
        for schedule in schedules.values():
            yaml += schedule.to_openfisca_parameter()
            yaml += "\n"
        
        return yaml


# ---------------------------------------------------------------------------
#  5. Main execution and testing
# ---------------------------------------------------------------------------

def compile_courgette(source_text: str) -> Tuple[str, str]:
    """
    Compile Courgette source to OpenFisca code
    Returns: (python_code, parameter_yaml)
    """
    parser = CourgetteParser()
    generator = OpenFiscaGenerator()
    
    # Parse
    scenarios, definitions, schedules = parser.parse(source_text)
    
    # Generate
    python_code, param_yaml = generator.generate(scenarios, definitions, schedules)
    
    return python_code, param_yaml


# Example usage and testing
if __name__ == "__main__":
    # Test with Australian benefits
    sample_courgette = """
Definition: assessable_income
  The total of employment income, investment income, and deemed income from financial assets

Definition: asset_value  
  Total value of all assessable assets excluding the principal home

Schedule: Age Pension Rates
  When single: $1,096.70 per fortnight
  When couple combined: $1,650.40 per fortnight
  When couple separated by illness: $2,193.40 per fortnight

Scenario: Age Pension
  When age >= 67
  And is_australian_resident == true
  And residence_years >= 10
  And any of these are true:
    - assessable_income < 204
    - asset_value < 301750
  Then age_pension_eligible = true
  And rate is determined by Age Pension Rates
  And payment reduces by 50 cents per dollar over $204

Scenario: Youth Allowance  
  When age between 16 and 24
  And any of these are true:
    - is_student == true
    - is_apprentice == true
    - employment_status == "job_seeker"
  And not is_independent
  And parental_income < 60000
  Then youth_allowance = true
  And payment is $350.50 per fortnight
"""
    
    python_code, param_yaml = compile_courgette(sample_courgette)
    
    print("=== Generated OpenFisca Code ===")
    print(python_code)
    print("\n=== Generated Parameters ===")
    print(param_yaml)
