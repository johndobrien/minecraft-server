#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MinecraftServerStatck, getStackProps } from '../lib/minecraft-server-stack';
import * as dotenv from 'dotenv';
import path from 'path';

// Construct the path to the .env file in the parent directory
const envPath = path.resolve(__dirname, '../../.env');

dotenv.config({ path: envPath });

const app = new cdk.App();
var props = getStackProps();

new MinecraftServerStatck(app, 'minecraft-server', props);
