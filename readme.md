# Courgette Codifier

> Plain English rules that compile to code – making legislation executable

## Overview

Courgette rules are a way of writing eligibility rules and calculations which are very close to plain language that can be automatically compiled to code.

### Why Courgette?

- **Readable by everyone**: Policy makers, lawyers, and citizens can understand the rules
- **Executable by computers**: Automatically generates working OpenFisca code
- **Testable and verifiable**: Rules can be validated against real scenarios
- **Maintainable**: Changes to policy can be directly reflected in the rules

## Simple Example Corgette Rules

```courgette
Scenario: Youth Allowance
  When age between 16 and 24
  And is_student == true
  And parental_income < 60000
  Then youth_allowance_eligible = true
  And payment is $350.50 per fortnight
```
Easy to read right? 

This compiles to complete OpenFisca Python code that can calculate eligibility and payment amounts.

```openfisca
from openfisca_core.model_api import *
from openfisca_core.periods import MONTH, YEAR, ETERNITY


class youth_allowance_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH
    label = "Youth Allowance eligibility"
    
    def formula(person, period, parameters):
        age = person('age', period)
        is_student = person('is_student', period)
        parental_income = person('parental_income', period)
        payment = person('payment', period)

        eligible = (
            (age >= 16 and person('youth_allowance_eligible', period) <= 24)
            and (is person('youth_allowance_eligible', period) student == True)
            and (parental person('youth_allowance_eligible', period) income < 60000)
            and (payment is $350.50 per fortnight)
        )

        return eligible
```

## How it works
 Courgette is an expanded version of [Cucumber/Gherkin](https://cucumber.io/docs/), using [Lark]([https://lark-parser.readthedocs.io/en/latest/](https://lark-parser.readthedocs.io/en/latest/philosophy.html)) free text parser to add custom syntax to cover legislative rules. This is exposed in a [Quill](https://quilljs.com/) wysiwyg editor styled with [AGDS](https://design-system.agriculture.gov.au/), and includes a compiler so that Courgette is continually compiled into [OpenFisca](https://openfisca.org/en/).

## Installation

### Try online 
You can play around with it in a test environment 
https://courgette-codifier.netlify.app/

### Web Editor

No installation is required
Just Download the files and open `index.html` in a browser. 
The editor includes:
- Syntax highlighting and validation
- Real-time OpenFisca code generation
- Example scenarios


## Courgette Syntax

### Basic Structure

A Courgette file consists of three types of blocks:

1. **Definitions** - Reusable terms and calculations
2. **Schedules** - Payment rates and thresholds
3. **Scenarios** - Eligibility rules and outcomes

This mirrors the structure of social security legislation, allowing easy comparison of the plain language against the legislative text by all stakeholders.  Given its always compiling to OpenFisca, if a stakeholder signs off on the easy to read Courgette, then they've also signed off on the generated OpenFisca, even if they don't understand code. 

### Definitions

Define terms that can be referenced throughout your rules:

```courgette
Definition: assessable_income
  The total of employment income, investment income, and deemed income

Definition: secondary_earner_income  
  The lower of partner A income and partner B income
```

### Schedules

Define payment rates, thresholds, or other values that vary by condition:

```courgette
Schedule: Age Pension Rates
  When single: $1,096.70 per fortnight
  When couple combined: $1,650.40 per fortnight
  When couple separated by illness: $2,193.40 per fortnight
```

### Scenarios

Define eligibility rules and calculate payments:

```courgette
Scenario: [Benefit Name]
  When [condition]
  And [condition]
  Then [outcome]
  And [outcome]
```

## Conditions

### Comparison Operators

```courgette
When age >= 67                    # Greater than or equal
And income < 20000                # Less than
And status == "unemployed"        # Equals
And has_partner != true           # Not equals
And hours <= 15                   # Less than or equal
And assets > 10000                # Greater than
```

### Range Conditions

```courgette
When age between 16 and 24       # Inclusive range
And income between 0 and 50000   # Any numeric range
```

### Boolean Conditions

```courgette
When is_student == true          # Explicit boolean
And studying                     # Implicit true (coming soon)
And not working_full_time        # Negation
```

### Logical Operators

#### All conditions must be true (AND)
```courgette
When age >= 16
And is_australian_resident == true
And income < 50000
```

#### Any condition must be true (OR)
```courgette
When age >= 67
Or has_disability == true
Or is_carer == true
```

#### Grouped Conditions

```courgette
When age >= 16
And any of these are true:
  - is_student == true
  - is_apprentice == true  
  - employment_status == "job_seeker"
And income < 30000
```

```courgette
When all of these are true:
  - age >= 67
  - residence_years >= 10
And none of these are true:
  - receiving_other_payment == true
  - assets > 500000
```

## Outcomes

### Eligibility

```courgette
Then youth_allowance_eligible = true
Then age_pension = true
```

### Fixed Payments

```courgette
Then payment is $512.50 per fortnight
Then payment is $1,096.70 per fortnight
```

### Schedule-based Payments

```courgette
Then rate is determined by Age Pension Rates
Then rate is determined by Youth Allowance Base Rates
```

### Payment Reductions

```courgette
Then payment reduces by 50 cents per dollar over $204
Then payment reduces by 20 cents per dollar over $5,767
```

### Multiple Outcomes

```courgette
Then family_tax_benefit_part_a = true
And rate is determined by FTB Part A Maximum Rates
And payment reduces by 20 cents per dollar over $58,108
And payment reduces by 30 cents per dollar over $103,368
```

## Complete Examples

### Simple Eligibility

```courgette
Scenario: Senior Card
  When age >= 60
  And working_hours <= 20
  And is_australian_resident == true
  Then senior_card_eligible = true
```

### Complex Payment Calculation

```courgette
Definition: assessable_income
  Total of employment, investment, and deemed income

Schedule: JobSeeker Base Rates
  When single no children: $693.10 per fortnight
  When single with children: $745.20 per fortnight
  When partnered: $631.20 per fortnight each

Scenario: JobSeeker Payment
  When age between 22 and age_pension_age
  And is_australian_resident == true
  And any of these are true:
    - employment_status == "unemployed"
    - employment_hours < 15
  And income < 1356.99
  Then jobseeker_payment_eligible = true
  And rate is determined by JobSeeker Base Rates
  And payment reduces by 50 cents per dollar over $150
  And payment reduces by 60 cents per dollar over $256
```

### Family Benefits with Multiple Parts

```courgette
Definition: ftb_child
  A dependent child under 16, or 16-19 in full-time secondary study

Schedule: FTB Part A Rates
  When child under 13: $197.96 per fortnight
  When child 13 to 15: $257.46 per fortnight

Schedule: FTB Part B Rates  
  When youngest under 5: $161.55 per fortnight
  When youngest 5 to 18: $112.55 per fortnight

Scenario: Family Tax Benefit Part A
  When has_ftb_child == true
  And family_income < 80000
  Then family_tax_benefit_part_a = true
  And rate is determined by FTB Part A Rates

Scenario: Family Tax Benefit Part B
  When has_ftb_child == true
  And any of these are true:
    - is_single_parent == true
    - secondary_earner_income < 5767
  Then family_tax_benefit_part_b = true
  And rate is determined by FTB Part B Rates
  And payment reduces by 20 cents per dollar over $5,767
```

## Style Guide

### Proper English

Where possible courgette supports Australian spelling and terminology:
- ✅ `recognise` not ❌ `recognize`
- ✅ `labour` not ❌ `labor`  
- ✅ `fortnight` not ❌ `two weeks`


### Naming Conventions

**Variables**: Use snake_case
just adding the underline automatically turns it into a variable
```courgette
is_australian_resident
has_dependent_children
taxable_income
```

**Scenarios**: Use Title Case
```courgette
Scenario: Age Pension
Scenario: Youth Allowance Student
Scenario: Family Tax Benefit Part A
```

**Schedules**: Use descriptive names with "Rates", "Thresholds", etc.
```courgette
Schedule: Age Pension Rates
Schedule: Income Test Thresholds
Schedule: Asset Test Limits
```

### Amounts and Periods

Always specify the payment period:
```courgette
$350.50 per fortnight
$175.25 per week
$4,563.00 per year
```

Use Australian number formatting:
```courgette
$1,096.70    # Comma for thousands
$50,000      # Round numbers can omit cents
```

### Comments

Use `#` for inline comments:
```courgette
When age >= 67  # Age Pension qualifying age
And residence_years >= 10  # General residence requirement
```

## Validation

The Courgette editor provides real-time validation:

- **Syntax errors**: Missing operators, unmatched quotes
- **Reference errors**: Undefined schedules or definitions
- **Style warnings**: Non-Australian spelling, incorrect capitalisation
- **Structure errors**: Missing outcomes, invalid block structure

## Generated OpenFisca Code

Courgette generates complete OpenFisca implementations including:

### Variables
```python
class youth_allowance_eligible(Variable):
    value_type = bool
    entity = Person
    definition_period = MONTH
    label = "Youth Allowance eligibility"
```

### Formulas
```python
def formula(person, period, parameters):
    age = person('age', period)
    is_student = person('is_student', period)
    parental_income = person('parental_income', period)
    
    return (
        (age >= 16) and (age <= 24) and
        (is_student == True) and
        (parental_income < 60000)
    )
```

### Parameters (YAML)
```yaml
youth_allowance_base_rates:
  description: Youth Allowance Base Rates
  values:
    single_at_home:
      value: 350.50
    single_away_from_home:
      value: 512.50
```

## Advanced Features

### Nested Conditions

```courgette
When is_couple == true
And all of these are true:
  - any of these are true:
    - partner_age >= 67
    - partner_has_disability == true
  - combined_income < 80000
  - combined_assets < 900000
```

### Multiple Reductions

```courgette
Then payment is $1,000 per fortnight
And payment reduces by 25 cents per dollar over $200
And payment reduces by 50 cents per dollar over $500
And payment cuts out at $1,200
```

### Conditional Schedules

```courgette
Schedule: Complex Rates
  When single and age < 21: $400
  When single and age >= 21: $500
  When couple and combined_income < 40000: $800
  When couple and combined_income >= 40000: $700
```

## Best Practices

1. **Start simple**: Write basic scenarios first, add complexity gradually
2. **Use definitions**: Extract complex calculations into named definitions
3. **Be explicit**: Write `== true` rather than relying on implicit booleans
4. **Comment edge cases**: Document special rules and exceptions
5. **Group related rules**: Keep scenarios for the same benefit together
6. **Test thoroughly**: Validate against real-world examples

## Roadmap

- [ ] Implicit boolean conditions (`When is_student` without `== true`)
- [ ] Date-based conditions (`When date >= "2024-01-01"`)
- [ ] Arithmetic in conditions (`When income + assets < 100000`)
- [ ] OpenFisca to Courgette reverse compilation
- [ ] Model Context Protocol tooling
- [ ] Direct compilation to CUDA for GPU policy modelling
- [ ] Multi-language support (te reo Māori)


## Contributing

The Courgette Method is open source and welcomes contributions. Areas where help is needed:

1. **Additional Australian benefits**: Implement more scenarios
2. **Validation rules**: Improve error messages and hints
3. **Documentation**: Add more examples and tutorials
4. **Testing**: Create test suites for complex scenarios

## License

MIT License - See LICENSE file for details

## Acknowledgements

Built for the Australian Government Rules as Code community. Special thanks to:
- The OpenFisca team for the underlying engine
- The Australian Digital Transformation Agency
- Policy makers who provided feedback on readability

---

*Remember: The goal is legislation that's as easy to read as a recipe, but as precise as code.*

