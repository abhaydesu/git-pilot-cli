#!/usr/bin/env node

import { program } from 'commander';
import { execa } from 'execa';
import axios from 'axios';

const getStagedDiff = async () => {
  try {
    const { stdout } = await execa('git', ['diff', '--staged']);
    return stdout;
  } catch (error) {
    console.error('Error getting git diff:', error.message);
    process.exit(1); 
  }
};

const API_URL = "http://localhost:3001/api/commit-message";

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

    try {
        console.log("contacting the local AI assistant..");

        const resposnse = await axios.post(API_URL, {
            intent, 
            diff
        });

        console.log('\n--- Staged Diff ---');
        console.log(resposnse.data.message);
        console.log('-------------------\n');
    } catch (error) {
        console.log("Error connecting the local assistant", error.message);
        console.log("Please ensure the API server is running..");
        process.exit(1);
    }
    });



program.parse(process.argv);