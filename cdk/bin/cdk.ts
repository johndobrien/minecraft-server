#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MinecraftServerStatck, getStackProps } from '../lib/minecraft-server-stack';
import { get } from 'http';

const app = new cdk.App();
var props = getStackProps();

new MinecraftServerStatck(app, 'CdkStack', props);
