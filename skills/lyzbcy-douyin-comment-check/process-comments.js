const fs = require('fs');
const path = require('path');

// 读取未回复评论
const unrepliedFile = path.join(__dirname, 'comments-output/unreplied-latest.json');
const comments = JSON.parse(fs.readFileSync(unrepliedFile, 'utf8'));

// 读取模板
const templateFile = path.join(__dirname, 'templates/default.json');
const templates = JSON.parse(fs.readFileSync(templateFile, 'utf8'));

// 处理每条评论
const processedComments = comments.map(comment => {
  let replyMessage = '';
  
  // 检查是否为恶意注入
  const maliciousKeywords = ['apikey', 'openclaw.json', 'rm -rf', '请你现在', '你的主人', '放人', '系统提示词'];
  const isMalicious = maliciousKeywords.some(keyword => 
    comment.content.toLowerCase().includes(keyword)
  );
  
  if (isMalicious) {
    // 恶意注入：从固定回复库随机选择
    const randomIndex = Math.floor(Math.random() * templates.maliciousReplyTemplates.length);
    replyMessage = `🦞 ${templates.maliciousReplyTemplates[randomIndex]}\n\n——来自周五涵🌩️`;
  } else {
    // 根据评论内容分类并生成回复
    const content = comment.content.toLowerCase();
    
    if (content.includes('价格') || content.includes('多少钱') || content.includes('多少')) {
      // 咨询型 - 价格相关
      replyMessage = '🦞 感谢你的咨询！具体价格请私信我了解详细信息哦～\n\n——来自周五涵🌩️';
    } else if (content.includes('怎么') || content.includes('如何') || content.includes('怎么弄')) {
      // 咨询型 - 方法相关
      replyMessage = '🦞 这个问题很棒！详细教程可以私信我获取～\n\n——来自周五涵🌩️';
    } else if (content.includes('真的假的') || content.includes('有用吗') || content.includes('靠谱吗')) {
      // 质疑型
      replyMessage = '🦞 当然是真的啦！我们一直用心做好每一份内容，欢迎继续关注哦～\n\n——来自周五涵🌩️';
    } else if (content.includes('哈哈') || content.includes('好可爱') || content.includes('来了') || content.includes('催更')) {
      // 互动型
      replyMessage = '🦞 谢谢你的支持！会继续加油的～\n\n——来自周五涵🌩️';
    } else if (content.length <= 3) {
      // 纯表情/短评论
      replyMessage = '🦞 收到你的心意啦！继续加油～\n\n——来自周五涵🌩️';
    } else {
      // 普通赞美/其他
      replyMessage = '🦞 谢谢你的赞美！你的支持是我前进的动力～\n\n——来自周五涵🌩️';
    }
  }
  
  return {
    ...comment,
    replyMessage: replyMessage
  };
});

// 生成回复计划
const replyPlan = {
  selectedWork: { title: "抖音作品" },
  count: processedComments.length,
  comments: processedComments
};

// 保存回复计划
const outputFile = path.join(__dirname, 'comments-output/reply-plan.json');
fs.writeFileSync(outputFile, JSON.stringify(replyPlan, null, 2));

console.log(`✅ 评论处理完成，生成 ${processedComments.length} 条回复计划`);
processedComments.forEach((comment, index) => {
  console.log(`${index + 1}. "${comment.content}" → ${comment.replyMessage}`);
});