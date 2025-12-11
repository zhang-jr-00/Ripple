# -*- coding: utf-8 -*-
"""
Test Topic Classification (English Version)
Simulates speech recognition output, testing if LangGraph can correctly classify sentences into topics.
"""

import asyncio
import sys

# Import components
from app import graph, store, MAX_POINTS_PER_TOPIC

# Test sentences (English, approx 20 words each)
TEST_SENTENCES = [
    "Recently I've been planning a trip to Yunnan, mainly just to relax,",
    "and take some photos. Actually what attracts me most is Erhai Lake in Dali",
    "and the Ancient Town of Lijiang. Friends told me the sunlight there is soft,",
    "perfect for a slow-paced life. I plan to stay in a homestay by Erhai,",
    "cycling around the lake in the morning, and watching stars at night. However,",
    "during booking I found my budget is tight, so I started replanning costs. I thought,",
    "maybe I can use points for flight tickets, and choose apartment-style homestays",
    "with kitchens, so cooking myself can save some money. By the way, I am comparing",
    "several portable cameras, looking for a lightweight model with good image quality.",
    "Speaking of cameras, I recalled a creative recording project I did before. That time",
    "I used voice to record daily inspirations, then used AI to organize them into topic cards.",
    "The result was better than expected—some thoughts looked scattered at first,",
    "but after organizing, they formed a clear thread. Now I want to integrate that",
    "method into daily writing, especially for quickly noting feelings during travel,",
    "so I can generate a visual diary directly after returning."
]

async def test_classification():
    print("=" * 80)
    print("🧪 Topic Classification Test (English)")
    print("=" * 80)
    print(f"\n📝 Testing {len(TEST_SENTENCES)} sentences\n")
    
    store.topics.clear()
    
    for i, sentence in enumerate(TEST_SENTENCES, 1):
        print(f"\n{'─' * 80}")
        print(f"📌 Processing {i}/{len(TEST_SENTENCES)}")
        print(f"📄 Content: {sentence}")
        
        try:
            await graph.ainvoke({"utterance": sentence})
            print(f"✅ Done. Topics count: {len(store.topics)}")
            
            # 打印所有话题的标签，检查是否有重复
            labels = [t.label for t in store.topics.values()]
            print(f"   Current labels: {labels}")
            
        except Exception as e:
            print(f"❌ Failed: {e}")
    
    print(f"\n{'=' * 80}")
    print("📊 Final Results")
    print("=" * 80)
    
    topics_list = sorted(store.topics.values(), key=lambda t: t.last_updated, reverse=True)
    
    for idx, topic in enumerate(topics_list, 1):
        print(f"\n【Topic {idx}】 {topic.label}")
        print(f"  📝 Summary: {topic.summary}")
        print(f"  📌 Points: {len(topic.points)}")
    
    print("\n✨ Test Completed!")

if __name__ == "__main__":
    try:
        asyncio.run(test_classification())
    except KeyboardInterrupt:
        pass
