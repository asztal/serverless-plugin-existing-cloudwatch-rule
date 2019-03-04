'use strict';

module.exports = class ExistingEventRulePlugin {
   constructor(serverless) {
      this.hooks = {
         'deploy:compileEvents': () => {
           Object.keys(serverless.service.functions).forEach(functionName => {
             const lambdaFunction = serverless.service.functions[functionName];
             lambdaFunction.events.forEach(event => {
               if (event.cloudWatchRule || event.cloudWatchRuleArn) {
                 const rule = event.cloudWatchRule || event.cloudWatchRuleArn;
                 const permission = this._makeEventPermission(functionName, rule);
                 serverless.service.provider.compiledCloudFormationTemplate.Resources[permission.name] = permission.definition;
                 serverless.cli.log(`Added permission for existing event rule "${rule}" to invoke "${functionName}"`);
               }
             });
           });
         }
      };
   }

   _normalizeName(s) {
     return (s[0].toUpperCase() + s.substr(1)).replace(/[-]/g, 'Dash').replace(/[_]/g, 'Underscore').replace(/[\/]/g, '');
     // as per https://serverless.com/framework/docs/providers/aws/guide/resources/
   }

   _buildPermissionSourceArn(rule) {
     if (rule.startsWith('arn')) { return rule; }
     const source = rule === 'ANY' ? 'rule/*' : rule;
     return { 'Fn::Join': [ ':', [ 'arn:aws:events', { 'Ref': 'AWS::Region' }, { 'Ref': 'AWS::AccountId' }, source ] ] };
   }

   _makeEventPermission(functionName, ruleIdentifier) {
      const normalizedFunctionName = this._normalizeName(functionName);
      const eventRuleName = (() => {
        const parts = ruleIdentifier.split(':');
        return parts[parts.length-1];
      })();
      const sourceArn = this._buildPermissionSourceArn(ruleIdentifier);

      return {
        name: `${normalizedFunctionName}LambdaPermission${this._normalizeName(eventRuleName)}`,
        definition: {
           Type: 'AWS::Lambda::Permission',
           Properties: {
              FunctionName: { 'Fn::GetAtt': [ `${normalizedFunctionName}LambdaFunction`, 'Arn' ] },
              Action: 'lambda:InvokeFunction',
              Principal: 'events.amazonaws.com',
              SourceArn: sourceArnIt seems like the "ANY" rule doesn't actually work because it generates an invalid lambda policy.

Here's the relevant part from my serverless.yml:
```
  getClusterMetrics:
    handler: scaling.getClusterMetrics
    timeout: 300
    events: 
    - cloudWatchRule: ANY
```

The function gets the following policy:
```
{
  "Version": "2012-10-17",
  "Id": "default",
  "Statement": [
    {
      "Sid": "operations-dev-GetClusterMetricsLambdaPermissionANY-ZOA748HJUOCH",
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-west-2:123456789012:function:operations-dev-getClusterMetrics",
      "Condition": {
        "ArnLike": {
          "AWS:SourceArn": "arn:aws:events:eu-west-2:123456789012:*"
        }
      }
    }
  ]
}
```

This rule doesn't work, all the invocations fail. The AWS documentation does seem to agree:

> You cannot use a wildcard in the portion of the ARN that specifies the resource type, such as the term user in an IAM ARN.
> 
> `arn:aws:iam::123456789012:u*`

And if I generate this through the cloudwatch console it actually generates this policy:
```
{
  "Version": "2012-10-17",
  "Id": "default",
  "Statement": [
    {
      "Sid": "AWSEvents_ecs-cluster-dev-metrics_Id1772996521410",
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-west-2:123456789012:function:operations-dev-getClusterMetrics",
      "Condition": {
        "ArnLike": {
          "AWS:SourceArn": "arn:aws:events:eu-west-2:123456789012:rule/ecs-cluster-dev-metrics"
        }
      }
    }
  ]
}
```

Which does work.

Changing the "*" to "rule/*" in the SourceArn condition should fix this.

           },
        }
      }
   }
};
