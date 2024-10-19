// middleware/multiPlanCheck.js

const planCheck = require('./planCheck');

const multiPlanCheck = (allowedPlans) => {
    return (req, res, next) => {
        const userPlan = req.user.plan;
        
        if (allowedPlans.includes(userPlan)) {
            next();
        } else {
            // Use o planCheck existente com o plano de menor hierarquia entre os permitidos
            const lowestAllowedPlan = allowedPlans.sort((a, b) => {
                const planHierarchy = ['gratuito', 'plus', 'premium'];
                return planHierarchy.indexOf(a) - planHierarchy.indexOf(b);
            })[0];
            
            planCheck(lowestAllowedPlan)(req, res, next);
        }
    };
};

module.exports = multiPlanCheck;