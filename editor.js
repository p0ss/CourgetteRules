// Courgette Editor UI Logic
// Handles Quill editor setup, validation integration, and UI interactions

// Create validation worker from external file
const validationWorker = new Worker('validator.js');

// Quill custom blots
const Block = Quill.import('blots/block');
const Inline = Quill.import('blots/inline');

// Scenario blot
class ScenarioBlot extends Block {
  static blotName = 'scenario';
  static tagName = 'h2';
  static className = 'scenario';
  
  static create(value) {
    const node = super.create();
    node.setAttribute('data-scenario', value);
    node.innerText = `Scenario: ${value}`;
    return node;
  }
  
  static formats(node) {
    return node.getAttribute('data-scenario');
  }
}

// Definition blot
class DefinitionBlot extends Block {
  static blotName = 'definition';
  static tagName = 'h3';
  static className = 'definition';
  
  static create(value) {
    const node = super.create();
    node.setAttribute('data-definition', value);
    node.innerText = `Definition: ${value}`;
    return node;
  }
  
  static formats(node) {
    return node.getAttribute('data-definition');
  }
}

// Schedule blot
class ScheduleBlot extends Block {
  static blotName = 'schedule';
  static tagName = 'h3';
  static className = 'schedule';
  
  static create(value) {
    const node = super.create();
    node.setAttribute('data-schedule', value);
    node.innerText = `Schedule: ${value}`;
    return node;
  }
  
  static formats(node) {
    return node.getAttribute('data-schedule');
  }
}

// Error inline blot
class ErrorBlot extends Inline {
  static blotName = 'error';
  static tagName = 'span';
  static className = 'error';
}

// Register all blots
Quill.register(ScenarioBlot);
Quill.register(DefinitionBlot);
Quill.register(ScheduleBlot);
Quill.register(ErrorBlot);

// Initialise Quill
const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: {
      container: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic'],
        [{ list: 'bullet' }],
        [{ 'indent': '-1' }, { 'indent': '+1' }],
        ['clean']
      ]
    }
  },
  placeholder: 'Start writing your rules here...'
});

// Add custom buttons to toolbar
const toolbar = quill.getModule('toolbar').container;
const customButtons = document.createElement('div');
customButtons.className = 'courgette-buttons';

// Scenario button
const scenarioBtn = document.createElement('button');
scenarioBtn.innerText = 'Add Scenario';
scenarioBtn.className = 'au-btn au-btn--small';
scenarioBtn.onclick = () => {
  const name = prompt('Scenario name:');
  if (name) {
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, 'scenario', name, Quill.sources.USER);
    quill.insertText(range.index + 1, '\n  When ', Quill.sources.USER);
    quill.setSelection(range.index + 8, Quill.sources.USER);
  }
};
customButtons.appendChild(scenarioBtn);

// Definition button
const defBtn = document.createElement('button');
defBtn.innerText = 'Add Definition';
defBtn.className = 'au-btn au-btn--small au-btn--secondary';
defBtn.onclick = () => {
  const name = prompt('Definition term:');
  if (name) {
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, 'definition', name, Quill.sources.USER);
    quill.insertText(range.index + 1, '\n  ', Quill.sources.USER);
    quill.setSelection(range.index + 3, Quill.sources.USER);
  }
};
customButtons.appendChild(defBtn);

// Schedule button
const schedBtn = document.createElement('button');
schedBtn.innerText = 'Add Schedule';
schedBtn.className = 'au-btn au-btn--small au-btn--secondary';
schedBtn.onclick = () => {
  const name = prompt('Schedule name:');
  if (name) {
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, 'schedule', name, Quill.sources.USER);
    quill.insertText(range.index + 1, '\n  When ', Quill.sources.USER);
    quill.setSelection(range.index + 8, Quill.sources.USER);
  }
};
customButtons.appendChild(schedBtn);

toolbar.appendChild(customButtons);

// Convert Quill delta to Courgette text
function deltaToCourgette(delta) {
  let text = '';
  let currentLine = '';
  
  delta.ops.forEach(op => {
    if (op.insert) {
      if (op.attributes && op.attributes.scenario) {
        if (currentLine) text += currentLine + '\n';
        text += `Scenario: ${op.attributes.scenario}\n`;
        currentLine = '';
      } else if (op.attributes && op.attributes.definition) {
        if (currentLine) text += currentLine + '\n';
        text += `Definition: ${op.attributes.definition}\n`;
        currentLine = '';
      } else if (op.attributes && op.attributes.schedule) {
        if (currentLine) text += currentLine + '\n';
        text += `Schedule: ${op.attributes.schedule}\n`;
        currentLine = '';
      } else if (typeof op.insert === 'string') {
        const lines = op.insert.split('\n');
        currentLine += lines[0];
        for (let i = 1; i < lines.length; i++) {
          text += currentLine + '\n';
          currentLine = lines[i];
        }
      }
    }
  });
  
  if (currentLine) text += currentLine;
  return text;
}

// Update functions
let updateTimer;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(updateEditor, 300);
}

function updateEditor() {
  const courgetteText = deltaToCourgette(quill.getContents());
  
  // Update word count
  const wordCount = courgetteText.trim().split(/\s+/).filter(w => w.length > 0).length;
  document.getElementById('wordCount').textContent = `${wordCount} words`;
  
  // Validate
  validationWorker.postMessage({ text: courgetteText });
  
  // Compile (from compiler.js)
  try {
    const openfiscaCode = compileToOpenFisca(courgetteText);
    document.getElementById('code').textContent = openfiscaCode;
    
    // Validate the generated OpenFisca code
    const openFiscaIssues = validateOpenFiscaCode(openfiscaCode);
    if (openFiscaIssues.length > 0) {
      console.warn('OpenFisca validation issues:', openFiscaIssues);
    }
  } catch (error) {
    document.getElementById('code').textContent = `# Compilation error\n# ${error.message}`;
  }
}

// Handle validation results
validationWorker.addEventListener('message', (e) => {
  const { errors } = e.data;
  const status = document.getElementById('status');
  const errorPanel = document.getElementById('errorPanel');
  
  if (errors.length === 0) {
    status.className = 'status-indicator valid';
    status.querySelector('span:last-child').textContent = 'Valid';
    errorPanel.style.display = 'none';
  } else {
    status.className = 'status-indicator error';
    status.querySelector('span:last-child').textContent = `${errors.length} error${errors.length > 1 ? 's' : ''}`;
    
    errorPanel.innerHTML = errors.map(err => 
      `<div class="error-item">Line ${err.line}: ${err.message}</div>`
    ).join('');
    errorPanel.style.display = 'block';
  }
});

// Example management
const examples = {
  youth_allowance: `Scenario: Youth Allowance
  When age is less than 25
  And any of these are true:
    - studying is true
    - employment_status is "unemployed"
  And income is less than 20000
  Then youth_allowance is eligible
  And payment is $350.50 per fortnight`,
  
  family_tax_benefit: `Definition: secondary_earner_income
  The lower of partner A income and partner B income

Schedule: FTB Part B Maximum Rates
  When youngest_child_age is less than 5: $161.55 per fortnight
  When youngest_child_age between 5 and 18: $112.55 per fortnight

Scenario: Family Tax Benefit Part B
  When is_couple is true
  And has_dependent_children is true
  And secondary_earner_income between 5767 and 28671
  Then family_tax_benefit_part_b is eligible
  And rate is determined by FTB Part B Maximum Rates
  And payment reduces by 20 cents per dollar over $5,767`,
  
  age_pension: `Definition: assessable_income
  Total of employment income, investment income, and deemed income from financial assets

Definition: asset_value
  Total value of all assessable assets excluding principal home

Scenario: Age Pension
  When age is at least 67
  And is_australian_resident is yes
  And residence_years is at least 10
  And assessable_income is less than 2115.40
  And asset_value is less than 419000
  Then age_pension is eligible
  And payment is $1096.70 per fortnight
  And payment reduces by 50 cents per dollar over $204`
};

function toggleExamples() {
  const panel = document.getElementById('examplesPanel');
  panel.classList.toggle('open');
}

function loadExample(key) {
  if (examples[key]) {
    quill.setText(examples[key]);
    toggleExamples();
    updateEditor();
  }
}

// Attach event listeners
quill.on('text-change', scheduleUpdate);

// Initial update
updateEditor();

// Make functions global for onclick handlers
window.toggleExamples = toggleExamples;
window.loadExample = loadExample;
