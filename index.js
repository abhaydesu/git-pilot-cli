#!/usr/bin/env node

import { program } from 'commander';
import { execa } from 'execa';

const getStagedDiff = async () => {
  try {
    const { stdout } = await execa('git', ['diff', '--staged']);
    return stdout;
  } catch (error) {
    console.error('Error getting git diff:', error.message);
    process.exit(1); 
  }
};

program
  .name('git-pilot')
  .description('An AI-powered Git assistant in your command line.');

program
  .command('commit')
  .description('Generate an AI-powered commit message.')
  .argument('<string>', 'The user\'s intent for the commit (e.g., "add a new feature")')
  .action(async (intent) => {
    console.log('Analyzing your staged changes...');

    const diff = await getStagedDiff();

    if (!diff) {
      console.log('No staged changes found. Please stage your files with `git add`.');
      process.exit(0);
    }

    console.log('\n--- Staged Diff ---');
    console.log(diff);
    console.log('-------------------\n');
    console.log(`User intent: "${intent}"`);
  });

program.parse(process.argv);